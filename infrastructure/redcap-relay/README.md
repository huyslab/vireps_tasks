# REDCap relay Lambda

This directory contains the AWS SAM source for the Lambda/API Gateway endpoint used by
`core/utils/data-queue.js`. It is adapted from
[`huyslab/relmed_lambda_creator`](https://github.com/huyslab/relmed_lambda_creator), but is
kept here so changes to the browser payload and relay allow-list can be reviewed together.

The relay imports the short record metadata into REDCap and uploads the large `data` value
to REDCap's `data` file field. `snapshot_version` is deliberately included in the metadata
allow-list so each cumulative browser snapshot can be identified in REDCap's audit history.

The write route is protected by enrolled-device signatures. Each approved browser holds a
non-exportable P-256 private key in IndexedDB and signs the exact REDCap record ID, current
timestamp, and a random nonce for every network attempt. API Gateway invokes a request
authorizer which verifies the signature against the registered public key and atomically
records the nonce to prevent replay. The relay also compares the authorizer's record ID with
the JSON payload before using its privileged REDCap token.

An unapproved browser can still run the task in demo mode, but `data-queue.js` neither sends
nor persists demo data.

## REDCap fields

The target REDCap project must contain:

- `record_id`
- `participant_id`
- `sitting_start_time`
- `session`
- `module`
- `snapshot_version` — text field with integer validation
- `data` — File field containing the raw jsPsych JSON

Add `snapshot_version` before deploying this handler. REDCap can reject a record import when
the payload contains a field that is absent from the project data dictionary.

## Deploy

Prerequisites are an authenticated AWS CLI, AWS SAM CLI, and Docker. From this directory:

```bash
sam build --use-container
sam deploy --guided
```

Supply the REDCap API URL and project token when prompted. On later deployments, use:

```bash
sam build --use-container
sam deploy
```

The deployed endpoint is emitted as the `REDCapRelayEndpoint` stack output. This upgrade
introduces an explicit API Gateway resource, so deploy the stack first and compare that
output with `REDCAP_ENDPOINT` in `core/utils/device-auth.js`. If it differs, update the
browser constant before deploying the browser application. Enrol tablets only after both
deployments are complete.

The stack also emits `DeviceEnrollmentEndpoint` and `DeviceAuthTableName`. The DynamoDB
table uses on-demand billing and is retained if the CloudFormation stack is deleted so an
accidental stack removal does not silently de-authorize every field tablet.

The API stage is throttled to 10 requests per second with a burst of 20. For defence in
depth, configure an AWS Budget or billing alarm for the account; API Gateway throttling is
best-effort rather than a guaranteed spending cap.

## Enrol a tablet

The administration script requires AWS credentials with access to the device-auth table and
the local `boto3` package. First create a single-use code (15 minutes by default):

```bash
python3 manage_devices.py --table-name <DeviceAuthTableName> \
  create-enrollment --label "Pharmacy tablet 1"
```

On the tablet, open `device-enrollment.html` from the deployed task site and enter the code.
The code is stored in DynamoDB only as a SHA-256 hash, is consumed atomically, and cannot be
used a second time. The private key never leaves the browser profile; clearing that site's
browser data removes the device identity and requires a new enrollment.

List or revoke devices with:

```bash
python3 manage_devices.py --table-name <DeviceAuthTableName> list
python3 manage_devices.py --table-name <DeviceAuthTableName> revoke <device-id>
```

A revoked tablet receives an authorization failure and cannot write to REDCap. When that
status can be checked at experiment startup it is placed in demo mode. A locally enrolled
tablet that is temporarily offline remains in collection mode so it can queue data; the
server still enforces revocation when a later upload is attempted.

## Request authorization

Authenticated requests carry `X-Device-Id`, `X-Record-Id`, `X-Request-Timestamp`,
`X-Request-Nonce`, and `X-Device-Signature`. The canonical signed value is:

```text
v1\n<device-id>\n<record-id>\n<unix-timestamp>\n<nonce>
```

Signatures are accepted for five minutes and authorizer caching is disabled. Every retry
uses a new timestamp, nonce, and signature, so IndexedDB records can remain offline without
carrying an expiring bearer credential.

## Validate locally

```bash
python3 -m unittest -v
python3 -m py_compile device_auth.py lambda_function.py manage_devices.py
sam validate --template-file template.yaml
```
