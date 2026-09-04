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
        event = {
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

        result = lambda_function.lambda_handler(event, None)

        self.assertEqual(result["statusCode"], 200)
        record_request = post.call_args_list[0]
        imported_records = json.loads(record_request.kwargs["data"]["data"])
        self.assertEqual(imported_records[0]["snapshot_version"], 42)
        self.assertNotIn("not_a_redcap_field", imported_records[0])
        self.assertNotIn("data", imported_records[0])

        file_request = post.call_args_list[1]
        uploaded_file = file_request.kwargs["files"]["file"][1]
        self.assertEqual(uploaded_file.getvalue(), b'{"trials":[]}')


if __name__ == "__main__":
    unittest.main()
