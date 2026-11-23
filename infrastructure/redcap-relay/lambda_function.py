import io
import json
import re
from os import environ

import requests


def lambda_response(status_code, body):
    return {
        "isBase64Encoded": False,
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }


def response_body(response):
    try:
        return response.json()
    except ValueError:
        return response.text


def response_succeeded(response):
    body = response_body(response)
    return (
        200 <= response.status_code < 300
        and not (isinstance(body, dict) and "error" in body)
        and not (isinstance(body, dict) and "count" in body and body["count"] != 1)
    )


def failure_status(response):
    # REDCap may report an application error in an HTTP-success response. The browser
    # must retain that snapshot for retry rather than treating a 200 as a receipt.
    return response.status_code if not 200 <= response.status_code < 300 else 502


def valid_email(value):
    # Match the browser email input's single-address format; reject lists and controls.
    return isinstance(value, str) and len(value) <= 254 and re.fullmatch(
        r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
        r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
        r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*",
        value,
    ) is not None


def upload_file_to_redcap(record, file_content):
    token = environ.get("REDCAP_API_TOKEN")
    redcap_url = environ.get("REDCAP_URL")

    file_obj = io.BytesIO(file_content.encode("utf-8"))
    files = {
        "file": ("data.txt", file_obj, "text/plain"),
    }
    data = {
        "token": token,
        "content": "file",
        "action": "import",
        "record": record,
        "field": "data",
    }

    return requests.post(redcap_url, data=data, files=files)


def lambda_handler(event, context):
    token = environ.get("REDCAP_API_TOKEN")
    redcap_url = environ.get("REDCAP_URL")
    try:
        body_data = json.loads(event["body"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return lambda_response(400, {"error": "Request body must be valid JSON"})

    if (
        not isinstance(body_data, list)
        or len(body_data) != 1
        or not isinstance(body_data[0], dict)
    ):
        return lambda_response(
            400, {"error": "Request body must contain exactly one record object"}
        )

    record = body_data[0]

    authorized_record_id = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("authorized_record_id")
    )
    if authorized_record_id != record.get("record_id"):
        return lambda_response(403, {"error": "Record is not authorized"})

    if not isinstance(record.get("data"), str):
        return lambda_response(400, {"error": "Record data must be a string"})

    if "clinician_email" in record and not valid_email(record["clinician_email"]):
        return lambda_response(400, {"error": "Clinician email must be a single valid address"})
    if "module_completed" in record and not isinstance(record["module_completed"], bool):
        return lambda_response(400, {"error": "Module completion must be a boolean"})

    def select_keys(record, keys):
        return {key: record[key] for key in keys if key in record}

    # Keep this list aligned with the fields in the REDCap project. snapshot_version is
    # generated atomically by core/utils/data-queue.js and retained in REDCap to make rare
    # delayed/out-of-order Lambda writes straightforward to diagnose in the audit log.
    record_keys = [
        "record_id",
        "participant_id",
        "sitting_start_time",
        "session",
        "module",
        "snapshot_version",
        "clinician_email",
    ]
    data_stripped = [select_keys(record, record_keys)]

    data = {
        "token": token,
        "content": "record",
        "action": "import",
        "format": "json",
        "type": "flat",
        "overwriteBehavior": "normal",
        "data": json.dumps(data_stripped),
        "returnFormat": "json",
    }

    record_response = requests.post(redcap_url, data=data)
    print(f"Record status: {record_response.status_code}")
    print(f"Record response: {record_response.text}")

    if not response_succeeded(record_response):
        return lambda_response(
            failure_status(record_response),
            {
                "record_import_response": response_body(record_response),
                "file_upload_response": None,
            },
        )

    record_id = record["record_id"]
    jspsych_data = record["data"]
    file_upload_response = upload_file_to_redcap(record_id, jspsych_data)
    print(f"File upload status: {file_upload_response.status_code}")
    print(f"File upload response: {file_upload_response.text}")

    # The instrument's completion field is absent from the first import's allow-list.
    # Importing it before the file arrives could email a false confirmation. Checkpoints
    # never set or clear it; REDCap's once-per-record Alert setting deduplicates retries.
    if (response_succeeded(file_upload_response)
            and record.get("module_completed") is True):
        completion_data = {
            **data,
            "data": json.dumps([{"record_id": record_id, "task_data_complete": "2"}]),
        }
        completion_response = requests.post(redcap_url, data=completion_data)
        if not response_succeeded(completion_response):
            return lambda_response(failure_status(completion_response), {
                "record_import_response": response_body(record_response),
                "file_upload_response": file_upload_response.status_code,
                "completion_import_response": response_body(completion_response),
            })

    status_code = (200 if response_succeeded(file_upload_response)
                   else failure_status(file_upload_response))
    return lambda_response(
        status_code,
        {
            "record_import_response": response_body(record_response),
            "file_upload_response": file_upload_response.status_code,
        },
    )
