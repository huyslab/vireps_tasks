import io
import json
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
    return 200 <= response.status_code < 300


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
            record_response.status_code,
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

    status_code = (
        record_response.status_code
        if response_succeeded(file_upload_response)
        else file_upload_response.status_code
    )
    return lambda_response(
        status_code,
        {
            "record_import_response": response_body(record_response),
            "file_upload_response": file_upload_response.status_code,
        },
    )
