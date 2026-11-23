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
- `clinician_email` — optional clinician recipient, text field with email validation

The existing Task Data instrument has REDCap's automatic `task_data_complete` field:
`0` = Incomplete, `1` = Unverified, `2` = Complete. This was verified in the
[VIREPS task data Codebook, project 9209](https://redcap.slms.ucl.ac.uk/redcap_v17.5.9/Design/data_dictionary_codebook.php?pid=9209)
on 23 November 2026. No extra completion field or stack parameter is needed.

Add `snapshot_version` and `clinician_email` before deploying this handler. REDCap can reject
a record import when the payload contains a field absent from the project data dictionary.

## Clinician alerts

Each launched module/sitting has its own REDCap record. `index.html` accepts an optional
clinician email and passes it through tab-scoped session storage using a random launch
token. The address is never placed in the URL or added to individual jsPsych trial rows.
It is included in queued REDCap metadata, including the initial snapshot queued by
`enterExperiment`, so REDCap can register a warning while the module is still running.
Another launch without an email does not inherit the previous recipient. The launcher and
relay accept only addresses REDCap's email validation accepts (a dotted domain ending in a
letters-only top-level domain, no doubled dots). If REDCap still rejects an import carrying
the address with a non-5xx error, the relay imports the snapshot again without it, so the
task data is saved and only that module's alerts are lost. Enrolled-device
checks and demo/development suppression apply to these snapshots as usual.

`endExperiment` adds the relay-only boolean `module_completed: true`. The relay imports
metadata, uploads the `data` file, and only after both succeed imports the
`task_data_complete` field with value `2` (Complete), including when no email was requested.
The browser cannot set this field through the metadata allow-list. Checkpoints leave its
status untouched, so they cannot reset a completed record. New module records use REDCap's
default Incomplete status (`0`). A failed
final upload or completion-status import returns a failure and leaves the snapshot queued
for retry. The marker and recipient survive in IndexedDB even after the experiment page
closes; a subsequent visit to the task site can retry them.

Before deploying the browser feature:

1. Add `clinician_email` to the Task Data instrument, with email validation. Its existing
   `task_data_complete` variable is used for completion. Do not add a custom completion flag.
2. Configure the two Alerts below in the target REDCap project, using a project-approved
   From address. Both use **conditional logic during data import/data entry**, rather than
   a form-save or survey-completion trigger. Set **Email To** to the `clinician_email`
   field and configure each Alert to send **once per record**, with no repeats or expiry.
3. Deploy the relay, then deploy the browser application. Existing saves without a
   recipient remain compatible.
4. Validate with a designated test recipient and an approved test device before study use.
   Automated local tests mock REDCap; they do not configure Alerts or send email.

| Alert | Trigger logic | Schedule |
| --- | --- | --- |
| Module data saved | `[clinician_email] <> '' and [task_data_complete] = '2'` | Immediately, once per record |
| Completion/upload unconfirmed | `[clinician_email] <> '' and [task_data_complete] <> '2'` | 60 minutes after triggering, once per record; enable **Ensure logic is still true before sending** |

The delayed Alert must recheck its condition before sending. A completion imported during
the hour then suppresses the warning. If upload succeeds after a warning has already been
sent, the separate completion Alert still sends its confirmation. Once-per-record settings
prevent retries and repeated final callbacks from sending duplicate notifications.

Suggested messages (no task results or raw-data attachments):

**Completion subject:** `VIREPS module data saved`

```text
The completed module's task data has been saved to REDCap.
Participant code: [participant_id]
Session: [session]
Module: [module]
Sitting started: [sitting_start_time]
```

**Warning subject:** `VIREPS module completion/upload unconfirmed`

```text
REDCap registered this module about one hour ago but has not confirmed a completed upload.
Participant code: [participant_id]
Session: [session]
Module: [module]
Sitting started: [sitting_start_time]

The module may still be running, may have been interrupted, or may have finished while
offline. Data may still be stored on the tablet. Please check the tablet, reconnect it,
and open the task site to allow pending uploads. Do not clear its browser storage.
```

The timer begins when the first recipient-bearing metadata import reaches REDCap, not
when an offline module begins. A tablet offline from the outset cannot be monitored until
that initial import arrives. REDCap cannot inspect the tablet's local queue: the warning
means completion/upload is unconfirmed, not that local data is known to exist. Legitimately
long modules can also produce the warning. These Alerts depend on REDCap's mail delivery
and scheduled-job processing; inspect the Notification Log when validating their timing.

REDCap documents [logic-based Alerts on imported data](https://help.redcap.ualberta.ca/help-and-faq/communications-alerts/alerts)
and [delayed sending, recipient fields, and pre-send condition checking](https://redcapucdenver.zendesk.com/hc/en-us/articles/31119566714004-Alerts-Notifications).

## Deploy

Prerequisites are an authenticated AWS CLI, AWS SAM CLI, and Docker. Follow the complete
[infrastructure deployment guide](../README.md), including its explicit artifact-bucket and
non-guided deployment commands. Do not use `sam deploy --guided` in the UCL account: an
organisation policy prevents creation of SAM's automatic artifact bucket.

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
its local administrator dependencies. Install them once from this directory:

```bash
python3 -m pip install -r requirements-admin.txt
```

Create a single-use code (15 minutes by default), supplying the public HTTPS URL of the
enrollment page:

```bash
AWS_PROFILE=ucl-sso AWS_DEFAULT_REGION=eu-north-1 \
python3 manage_devices.py --table-name <DeviceAuthTableName> \
  create-enrollment --label "Pharmacy tablet 1" \
  --enrollment-page-url "https://<task-site>/device-enrollment.html"
```

The command displays both a locally generated QR code and a 12-character fallback such as
`7K3M-P9XR-D2HF`. Scan the QR with the tablet, then tap **Approve device** on the page it
opens. Once approved, tap **Start data collection** to open the task launcher. If the camera
is unavailable, open `device-enrollment.html` from the deployed task site and enter the
fallback code; hyphens, spaces and letter case do not matter.

The QR puts the code in a URL fragment, which is not sent to the web server and is removed
from the address bar and current browser-history entry as soon as the page loads. The code
is stored in DynamoDB only as a SHA-256 hash, is consumed atomically, and cannot be used a
second time. The private key never leaves the browser profile; clearing that site's browser
data removes the device identity and requires a new enrollment.

List or revoke devices with:

```bash
python3 manage_devices.py --table-name <DeviceAuthTableName> list
python3 manage_devices.py --table-name <DeviceAuthTableName> revoke <device-id>
```

A revoked tablet receives an authorization failure and cannot write to REDCap. When that
status can be checked at experiment startup it is placed in demo mode, and a session run in
demo mode is neither sent nor written to the local queue, so revocation leaves no participant
data behind for a later enrollment to upload. A locally enrolled tablet that is temporarily
offline is a different case: an unreachable status service leaves it in collection mode so it
can queue data, and the server still enforces revocation when a later upload is attempted.

### Why `device-status` is not behind the authorizer

Demo mode discards a session, so the browser needs a differentiated answer before it enters
one. The request authorizer cannot give it: it answers only "may this write proceed", and
returns the same opaque 401 for a revoked device, an unknown device, a bad signature and a
timestamp outside the five-minute window. Read as "unapproved", that 401 would put a tablet
whose clock has drifted into demo mode and throw the session away.

`POST /redcap/device-status` therefore runs outside the authorizer and verifies the
same signature itself, returning a typed verdict:

| Response | Meaning | Browser behaviour |
| --- | --- | --- |
| `200 {"status":"approved"}` | Enrolled, approved, fresh | Collects and sends |
| `200 {"status":"clock_skew"}` | Signature and enrollment verified, timestamp stale | Collects; corrects its clock from `server_time` |
| `200 {"status":"unapproved"}` | Revoked or unknown to the server | Demo mode - collects nothing |
| `401` | Malformed or unverifiable credentials | Treated as "cannot tell": collects and queues |

Only an explicit `unapproved` stops a device collecting. Every response carries
`server_time`, and the browser signs all later requests - REDCap writes included - against
that clock, so a drifted tablet's queued data can actually be delivered rather than failing
authorization forever. The offset is measured at startup and re-measured whenever a write
comes back 401 or 403, so a tablet that booted with no network still recovers when
connectivity returns instead of signing with its drifted clock for the rest of the session.
That refresh reads only `server_time`: it never reconsiders approval, so a background retry
cannot put a running session into demo mode. The route records no nonce: it is read-only, must keep working
precisely when timestamps are stale, and discloses nothing beyond the status of the device
whose signature it just verified.

Deploy the stack before the browser application. A new browser against an old relay still
works and fails safe - an undifferentiated 401 is read as "cannot tell", so the tablet
collects and queues rather than discarding anything; it simply will not enter demo mode
until the new handler is live.

## Request authorization

Authenticated requests carry `X-Device-Id`, `X-Record-Id`, `X-Request-Timestamp`,
`X-Request-Nonce`, and `X-Device-Signature`. The canonical signed value is:

```text
v1\n<device-id>\n<record-id>\n<unix-timestamp>\n<nonce>
```

Signatures are accepted for five minutes and authorizer caching is disabled. Every retry
uses a new timestamp, nonce, and signature, so IndexedDB records can remain offline without
carrying an expiring bearer credential. The timestamp is the browser's own clock corrected by
the offset last reported by `device-status`, so a drifted tablet still signs inside the
window.

## Validate locally

```bash
python3 -m unittest -v
python3 -m py_compile device_auth.py lambda_function.py manage_devices.py
sam validate --template-file template.yaml
```
