# REDCap relay Lambda

This directory contains the AWS SAM source for the Lambda/API Gateway endpoint used by
`core/utils/data-queue.js`. It is adapted from
[`huyslab/relmed_lambda_creator`](https://github.com/huyslab/relmed_lambda_creator), but is
kept here so changes to the browser payload and relay allow-list can be reviewed together.

The relay imports the short record metadata into REDCap and uploads the large `data` value
to REDCap's `data` file field. `snapshot_version` is deliberately included in the metadata
allow-list so each cumulative browser snapshot can be identified in REDCap's audit history.

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

The deployed endpoint is emitted as the `REDCapRelayEndpoint` stack output. If a new stack
produces a different API Gateway URL, update `REDCAP_ENDPOINT` in
`core/utils/data-queue.js` before deploying the browser application.
