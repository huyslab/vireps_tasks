# Infrastructure deployment

This directory contains the AWS infrastructure for the Vireps tasks. The current stack is
the authenticated REDCap relay in [`redcap-relay`](redcap-relay/README.md). It creates API
Gateway routes, four Lambda functions, their IAM roles, and a DynamoDB table used to enrol
and authorize data-collection devices.

The deployment described here uses the UCL AWS account and works around a UCL
organisation-level policy that prevents the AWS SAM CLI from creating its usual managed
artifact bucket.

## Fixed deployment names

The examples below use these values consistently:

| Setting | Value |
| --- | --- |
| AWS CLI profile | `ucl-sso` |
| AWS account | `843414937160` |
| AWS region | `eu-north-1` |
| CloudFormation stack | `vireps-redcap-relay` |
| SAM artifact bucket | `ucl-vireps-sam-artifacts-843414937160-eu-north-1` |

S3 bucket names are globally unique. If the artifact bucket is being recreated in a
different account, replace the account number in its name. If that name is nevertheless
taken, add a unique suffix and use the resulting name in every command below.

## 1. Configure the UCL AWS login

Install AWS CLI v2, AWS SAM CLI, and Docker. Configure a short local profile name:

```bash
aws configure sso --profile ucl-sso
```

Use the AWS access portal URL and SSO region supplied by UCL. The remaining choices are:

- SSO session name: `ucl` (this is only a local label)
- SSO registration scopes: `sso:account:access`
- AWS account: `843414937160`
- Role: the UCL role assigned to this project, currently `AWSAdministratorAccess`
- Default region: `eu-north-1`
- Default output format: `json`
- Profile name: keep `ucl-sso`

The SSO session name and profile name do not have to match. The profile name is the value
passed to `--profile` in the commands below. Re-running `aws configure sso --profile
ucl-sso` is also the simplest way to replace an accidentally accepted long profile name.

Start a session and verify that it selected the expected account:

```bash
aws sso login --profile ucl-sso

aws sts get-caller-identity --profile ucl-sso
```

The returned `Account` must be `843414937160`. Repeat `aws sso login` whenever the cached
SSO session expires.

## 2. Prepare REDCap

The target REDCap project must contain all the fields listed in the
[relay-specific README](redcap-relay/README.md#redcap-fields), including:

- `snapshot_version`, configured as a text field with integer validation
- `data`, configured as a File field

Obtain the project's REDCap API URL and API token. Do not commit the token or save it in
`samconfig.toml`.

## 3. Create the SAM artifact bucket

This is required only once per AWS account and region. Check whether it already exists:

```bash
aws s3api head-bucket \
  --bucket ucl-vireps-sam-artifacts-843414937160-eu-north-1 \
  --profile ucl-sso
```

If that command reports that the bucket does not exist, create it directly:

```bash
aws s3api create-bucket \
  --bucket ucl-vireps-sam-artifacts-843414937160-eu-north-1 \
  --region eu-north-1 \
  --create-bucket-configuration LocationConstraint=eu-north-1 \
  --profile ucl-sso
```

S3 enables Block Public Access for new buckets by default. Verify it before uploading
artifacts:

```bash
aws s3api get-public-access-block \
  --bucket ucl-vireps-sam-artifacts-843414937160-eu-north-1 \
  --profile ucl-sso
```

All four returned settings should be `true`.

### Why the bucket is created manually

The UCL AWS Organizations service control policy (SCP) `p-adgbzlz1` explicitly denies
`s3:PutBucketPublicAccessBlock`. That denial applies even when the selected SSO role has
`AWSAdministratorAccess`.

SAM normally creates a helper CloudFormation stack named
`aws-sam-cli-managed-default`. Its bucket creation calls the denied S3 operation, leaving
the helper stack in `ROLLBACK_COMPLETE`. A later attempt then reports that the stack is
missing tags or outputs and is not healthy.

Do not use `sam deploy --guided` in this account. In the current SAM CLI, guided mode
always consults the managed helper stack, even when `--s3-bucket` is supplied. Disabling
rollback does not bypass the SCP; it only retains partially created resources after a
failure.

The explicit bucket plus non-guided deployment below bypasses the helper stack entirely.
The failed helper stack can be left in place because it is not used.

## 4. Build and deploy the stack

Run these commands from the repository root:

```bash
cd infrastructure/redcap-relay

sam build --use-container
```

Read the REDCap credentials into temporary shell variables. The token prompt does not echo
its value, and neither value is written into shell history:

```bash
read -r "VIREPS_REDCAP_URL?REDCap API URL: "
read -rs "VIREPS_REDCAP_TOKEN?REDCap API token: "
echo
```

Deploy without guided mode or automatic S3 resolution:

```bash
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name vireps-redcap-relay \
  --region eu-north-1 \
  --profile ucl-sso \
  --s3-bucket ucl-vireps-sam-artifacts-843414937160-eu-north-1 \
  --s3-prefix vireps-redcap-relay \
  --no-resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "REDCapUrl=$VIREPS_REDCAP_URL" \
    "REDCapApiToken=$VIREPS_REDCAP_TOKEN" \
  --confirm-changeset
```

Inspect the proposed CloudFormation change set and confirm it only when the changes are
expected. Clear both variables afterwards:

```bash
unset VIREPS_REDCAP_TOKEN VIREPS_REDCAP_URL
```

The same build and deploy procedure is used for subsequent updates. Supplying the explicit
bucket and `--no-resolve-s3` remains necessary on every deployment.

## 5. Verify the deployment

Check the stack state and print its outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name vireps-redcap-relay \
  --region eu-north-1 \
  --profile ucl-sso \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}'
```

The stack should finish in `CREATE_COMPLETE` on its first deployment or `UPDATE_COMPLETE`
on later deployments. Record these outputs:

- `REDCapRelayEndpoint`
- `DeviceEnrollmentEndpoint`
- `DeviceAuthTableName`

Compare `REDCapRelayEndpoint` with `REDCAP_ENDPOINT` in
`core/utils/device-auth.js`. If it changed, update and deploy the browser application before
enrolling tablets. Device enrolment and revocation are documented in the
[relay-specific README](redcap-relay/README.md#enrol-a-tablet).

## Recreating the infrastructure in an empty account

To reproduce the deployment from scratch:

1. Configure and verify the UCL SSO profile.
2. Add the required fields to the destination REDCap project and obtain its API token.
3. Create a private artifact bucket in the target account and region.
4. Update the fixed names in the deployment command if the account, region, bucket, or
   desired stack name differs.
5. Build and perform the non-guided deployment.
6. Verify the CloudFormation outputs and configure the browser endpoint.
7. Create one-time enrolment codes and enrol the data-collection tablets.

The DynamoDB device-auth table has `DeletionPolicy: Retain`. Deleting the CloudFormation
stack therefore does not delete the old table or its records, but a subsequently recreated
stack will create and output a new table. Confirm which table is active before creating,
listing, or revoking device enrolments.

## Costs and controls

The artifact bucket has small storage and request costs. Lambda, API Gateway, and the
on-demand DynamoDB table are usage based and normally inexpensive at experimental volumes,
but they are not guaranteed to be free. The API is throttled to 10 requests per second with
a burst of 20. Configure an AWS Budget or billing alarm in the account as an additional
safeguard.

## Troubleshooting

### `aws-sam-cli-managed-default` is in `ROLLBACK_COMPLETE`

This is the expected symptom of the UCL SCP blocking SAM's automatic bucket. Use the
non-guided command above with both `--s3-bucket` and `--no-resolve-s3`. Deleting the helper
stack alone does not solve the policy problem; SAM will fail again if automatic resolution
is used.

### Access has expired

```bash
aws sso login --profile ucl-sso
```

Then repeat the failed command.

### The application stack rolls back

Inspect the first failed resource rather than only the final rollback event:

```bash
aws cloudformation describe-stack-events \
  --stack-name vireps-redcap-relay \
  --region eu-north-1 \
  --profile ucl-sso \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[Timestamp,LogicalResourceId,ResourceType,ResourceStatusReason]' \
  --output table
```

An organisation-level explicit deny cannot be fixed by selecting a broader IAM role inside
the account. If another SCP restriction appears, provide its denied action and policy ID to
the UCL AWS administrators.
