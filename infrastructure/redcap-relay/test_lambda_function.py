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
    def valid_event(self, **fields):
        return {
            "requestContext": {
                "authorizer": {"authorized_record_id": "participant_session"}
            },
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
                        **fields,
                    }
                ]
            )
        }

    @patch("lambda_function.requests.post")
    def test_rejects_missing_empty_non_string_or_malformed_request_bodies(self, post):
        invalid_events = {
            "missing": {},
            "empty": {"body": ""},
            "non-string": {"body": []},
            "malformed": {"body": "not-json"},
        }

        for label, event in invalid_events.items():
            with self.subTest(label=label):
                post.reset_mock()

                result = lambda_function.lambda_handler(event, None)

                self.assertEqual(result["statusCode"], 400)
                self.assertEqual(
                    json.loads(result["body"]),
                    {"error": "Request body must be valid JSON"},
                )
                self.assertEqual(result["headers"]["Access-Control-Allow-Origin"], "*")
                post.assert_not_called()

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

    @patch("lambda_function.requests.post")
    def test_rejects_record_that_does_not_match_authorizer_context(self, post):
        event = self.valid_event()
        event["requestContext"]["authorizer"]["authorized_record_id"] = "other"

        result = lambda_function.lambda_handler(event, None)

        self.assertEqual(result["statusCode"], 403)
        self.assertEqual(json.loads(result["body"]), {"error": "Record is not authorized"})
        post.assert_not_called()

    @patch("lambda_function.requests.post")
    def test_rejects_missing_or_non_string_data_before_importing_metadata(self, post):
        invalid_values = {
            "missing": None,
            "null": None,
            "object": {"trials": []},
            "array": [],
        }

        for label, value in invalid_values.items():
            with self.subTest(label=label):
                post.reset_mock()
                event = self.valid_event()
                record = json.loads(event["body"])[0]
                if label == "missing":
                    del record["data"]
                else:
                    record["data"] = value
                event["body"] = json.dumps([record])

                result = lambda_function.lambda_handler(event, None)

                self.assertEqual(result["statusCode"], 400)
                self.assertEqual(
                    json.loads(result["body"]),
                    {"error": "Record data must be a string"},
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


class ClinicianAlertTest(unittest.TestCase):
    valid_event = LambdaHandlerTest.valid_event
    @patch("lambda_function.requests.post")
    def test_checkpoint_registers_recipient_without_marking_complete(self, post):
        post.side_effect = [FakeResponse(200, {"count": 1}), FakeResponse(200, 1)]
        event = self.valid_event(clinician_email="clinician@example.test", task_data_complete="2")
        result = lambda_function.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 200)
        imported = json.loads(post.call_args_list[0].kwargs["data"]["data"])[0]
        self.assertEqual(imported["clinician_email"], "clinician@example.test")
        self.assertNotIn("task_data_complete", imported)
        self.assertEqual(post.call_count, 2)

    @patch("lambda_function.requests.post")
    def test_completion_is_written_only_after_successful_file_upload(self, post):
        post.side_effect = [FakeResponse(200, {"count": 1}), FakeResponse(200, 1), FakeResponse(200, {"count": 1})]
        event = self.valid_event(clinician_email="clinician@example.test", module_completed=True)
        result = lambda_function.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 200)
        metadata = json.loads(post.call_args_list[0].kwargs["data"]["data"])[0]
        self.assertNotIn("module_completed", metadata)
        self.assertNotIn("task_data_complete", metadata)
        self.assertIn("files", post.call_args_list[1].kwargs)
        completion = json.loads(post.call_args_list[2].kwargs["data"]["data"])
        self.assertEqual(completion, [{"record_id": "participant_session", "task_data_complete": "2"}])

    @patch("lambda_function.requests.post")
    def test_failed_final_file_upload_never_marks_complete(self, post):
        post.side_effect = [FakeResponse(200, {"count": 1}), FakeResponse(503, {"error": "unavailable"})]
        event = self.valid_event(clinician_email="clinician@example.test", module_completed=True)
        result = lambda_function.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 503)
        self.assertEqual(post.call_count, 2)

    @patch("lambda_function.requests.post")
    def test_failed_completion_import_returns_failure_for_outbox_retry(self, post):
        event = self.valid_event(clinician_email="clinician@example.test", module_completed=True)
        for response in [FakeResponse(503, {"error": "unavailable"}), FakeResponse(200, {"error": "invalid field"}), FakeResponse(200, {"count": 0})]:
            with self.subTest(response=response.text):
                post.side_effect = [FakeResponse(200, {"count": 1}), FakeResponse(200, 1), response]
                result = lambda_function.lambda_handler(event, None)
                self.assertGreaterEqual(result["statusCode"], 500)

    @patch("lambda_function.requests.post")
    def test_successful_retry_reuses_the_same_completion_record(self, post):
        post.side_effect = [FakeResponse(200, {"count": 1}), FakeResponse(200, 1), FakeResponse(200, {"count": 1})] * 2
        event = self.valid_event(clinician_email="clinician@example.test", module_completed=True)
        for _ in range(2):
            self.assertEqual(lambda_function.lambda_handler(event, None)["statusCode"], 200)
        self.assertEqual(post.call_args_list[2].kwargs, post.call_args_list[5].kwargs)

    @patch("lambda_function.requests.post")
    def test_rejects_invalid_recipient_and_completion_marker_before_writing(self, post):
        for email in [None, "", ["a@example.test"], "a@example.test,b@example.test", "a@example.test\nbcc:other@example.test", "no-at-sign", "a" * 250 + "@example.test",
                      "name@ucl", "x@localhost", "a..b@ucl.ac.uk", ".a@ucl.ac.uk", "a.@ucl.ac.uk", "a@ucl.ac.u", "a@ucl.ac.uk1"]:
            with self.subTest(email=email):
                event = self.valid_event(clinician_email=email)
                self.assertEqual(lambda_function.lambda_handler(event, None)["statusCode"], 400)
        for marker in ["true", 1, None, {}]:
            event = self.valid_event(clinician_email="clinician@example.test", module_completed=marker)
            self.assertEqual(lambda_function.lambda_handler(event, None)["statusCode"], 400)
        post.assert_not_called()

    def test_accepts_ordinary_addresses(self):
        for email in ["name@ucl.ac.uk", "first.last+tag@nhs.net", "a_b-c@sub.example.co.uk"]:
            with self.subTest(email=email):
                self.assertTrue(lambda_function.valid_email(email))

    @patch("lambda_function.requests.post")
    def test_rejected_recipient_falls_back_to_importing_data_without_it(self, post):
        for rejection in [FakeResponse(400, {"error": "clinician_email failed validation"}), FakeResponse(200, {"error": "unknown field"})]:
            with self.subTest(status=rejection.status_code):
                post.reset_mock()
                post.side_effect = [rejection, FakeResponse(200, {"count": 1}), FakeResponse(200, 1), FakeResponse(200, {"count": 1})]
                event = self.valid_event(clinician_email="clinician@example.test", module_completed=True)
                self.assertEqual(lambda_function.lambda_handler(event, None)["statusCode"], 200)
                retried = json.loads(post.call_args_list[1].kwargs["data"]["data"])[0]
                self.assertNotIn("clinician_email", retried)
                self.assertEqual(retried["record_id"], "participant_session")
                self.assertIn("files", post.call_args_list[2].kwargs)
                completion = json.loads(post.call_args_list[3].kwargs["data"]["data"])
                self.assertEqual(completion, [{"record_id": "participant_session", "task_data_complete": "2"}])

    @patch("lambda_function.requests.post")
    def test_transient_failure_with_recipient_is_left_for_outbox_retry(self, post):
        # Dropping the address on a retryable failure would let the fallback succeed and
        # dequeue the snapshot without a recipient, losing both alerts.
        for status in [503, 408, 429]:
            with self.subTest(status=status):
                post.reset_mock()
                post.side_effect = [FakeResponse(status, {"error": "try again"})]
                event = self.valid_event(clinician_email="clinician@example.test")
                self.assertEqual(lambda_function.lambda_handler(event, None)["statusCode"], status)
                self.assertEqual(post.call_count, 1)

    @patch("lambda_function.requests.post")
    def test_completion_status_is_updated_even_without_an_email(self, post):
        post.side_effect = [FakeResponse(200, {"count": 1}), FakeResponse(200, 1), FakeResponse(200, {"count": 1})]
        self.assertEqual(lambda_function.lambda_handler(self.valid_event(module_completed=True), None)["statusCode"], 200)
        completion = json.loads(post.call_args_list[2].kwargs["data"]["data"])[0]
        self.assertEqual(completion["task_data_complete"], "2")

    @patch("lambda_function.requests.post")
    def test_http_success_with_redcap_error_never_marks_complete(self, post):
        event = self.valid_event(clinician_email="clinician@example.test", module_completed=True)
        # A metadata rejection is retried once without the recipient before failing.
        for responses in [[FakeResponse(200, {"error": "metadata failed"})] * 2, [FakeResponse(200, {"count": 1}), FakeResponse(200, {"error": "file failed"})]]:
            with self.subTest(responses=len(responses)):
                post.reset_mock()
                post.side_effect = responses
                self.assertEqual(lambda_function.lambda_handler(event, None)["statusCode"], 502)
                self.assertEqual(post.call_count, len(responses))


if __name__ == "__main__":
    unittest.main()
