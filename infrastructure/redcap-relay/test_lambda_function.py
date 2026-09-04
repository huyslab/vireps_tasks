import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import lambda_function


class FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self.text = json.dumps(body)
        self.request = SimpleNamespace(headers={}, body="")
        self._body = body

    def json(self):
        return self._body


class LambdaHandlerTest(unittest.TestCase):
    def valid_event(self):
        return {
            "body": json.dumps(
                [
                    {
                        "record_id": "participant_session",
                        "participant_id": "participant",
                        "sitting_start_time": "2026-09-04_12:00:00",
                        "module": "go-no-go",
                        "snapshot_version": 42,
                        "data": "{\"trials\":[]}",
                        "not_a_redcap_field": "discard me",
                    }
                ]
            )
        }

    @patch("lambda_function.requests.post")
    def test_rejects_payloads_that_do_not_contain_exactly_one_record_object(self, post):
        valid_record = {
            "record_id": "participant_session",
            "data": "{\"trials\":[]}",
        }
        invalid_payloads = {
            "empty array": [],
            "multiple records": [valid_record, {**valid_record, "record_id": "other"}],
            "non-object record": ["not a record"],
            "non-array body": valid_record,
        }

        for label, payload in invalid_payloads.items():
            with self.subTest(label=label):
                post.reset_mock()
                result = lambda_function.lambda_handler(
                    {"body": json.dumps(payload)}, None
                )

                self.assertEqual(result["statusCode"], 400)
                self.assertEqual(
                    json.loads(result["body"]),
                    {"error": "Request body must contain exactly one record object"},
                )
                post.assert_not_called()

    @patch.dict(
        os.environ,
        {
            "REDCAP_API_TOKEN": "test-token",
            "REDCAP_URL": "https://redcap.example.test/api/",
        },
    )
    @patch("lambda_function.requests.post")
    def test_snapshot_version_is_forwarded_with_record_metadata(self, post):
        post.side_effect = [
            FakeResponse(200, {"count": 1}),
            FakeResponse(200, {"success": True}),
        ]
        result = lambda_function.lambda_handler(self.valid_event(), None)

        self.assertEqual(result["statusCode"], 200)
        record_request = post.call_args_list[0]
        imported_records = json.loads(record_request.kwargs["data"]["data"])
        self.assertEqual(imported_records[0]["snapshot_version"], 42)
        self.assertNotIn("not_a_redcap_field", imported_records[0])
        self.assertNotIn("data", imported_records[0])

        file_request = post.call_args_list[1]
        uploaded_file = file_request.kwargs["files"]["file"][1]
        self.assertEqual(uploaded_file.getvalue(), b'{"trials":[]}')

    @patch.dict(
        os.environ,
        {
            "REDCAP_API_TOKEN": "test-token",
            "REDCAP_URL": "https://redcap.example.test/api/",
        },
    )
    @patch("lambda_function.requests.post")
    def test_failed_record_import_returns_failure_without_uploading_file(self, post):
        post.return_value = FakeResponse(503, {"error": "record import failed"})

        result = lambda_function.lambda_handler(self.valid_event(), None)

        self.assertEqual(result["statusCode"], 503)
        self.assertEqual(
            json.loads(result["body"]),
            {
                "record_import_response": {"error": "record import failed"},
                "file_upload_response": None,
            },
        )
        post.assert_called_once()

    @patch.dict(
        os.environ,
        {
            "REDCAP_API_TOKEN": "test-token",
            "REDCAP_URL": "https://redcap.example.test/api/",
        },
    )
    @patch("lambda_function.requests.post")
    def test_failed_file_upload_returns_failure(self, post):
        post.side_effect = [
            FakeResponse(200, {"count": 1}),
            FakeResponse(500, {"error": "file upload failed"}),
        ]

        result = lambda_function.lambda_handler(self.valid_event(), None)

        self.assertEqual(result["statusCode"], 500)
        self.assertEqual(
            json.loads(result["body"]),
            {
                "record_import_response": {"count": 1},
                "file_upload_response": 500,
            },
        )
        self.assertEqual(post.call_count, 2)


if __name__ == "__main__":
    unittest.main()
