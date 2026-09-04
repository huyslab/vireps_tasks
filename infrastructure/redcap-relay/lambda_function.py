import io
import json
from os import environ

import requests


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
    body_data = json.loads(event["body"])

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
    data_stripped = body_data.copy()
    data_stripped[0] = select_keys(data_stripped[0], record_keys)

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

    record_id = body_data[0]["record_id"]
    jspsych_data = body_data[0]["data"]
    file_upload_response = upload_file_to_redcap(record_id, jspsych_data)
    print(f"File upload status: {file_upload_response.status_code}")
    print(f"File upload response: {file_upload_response.text}")

    return {
        "isBase64Encoded": False,
        "statusCode": record_response.status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(
            {
                "record_import_response": record_response.json(),
                "file_upload_response": file_upload_response.status_code,
            }
        ),
    }
