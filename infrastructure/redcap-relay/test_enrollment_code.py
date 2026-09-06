import unittest
from unittest.mock import patch

import enrollment_code


class EnrollmentCodeTest(unittest.TestCase):
    def test_generated_code_has_twelve_unambiguous_characters(self):
        expected = "7K3MP9XRD2HF"
        with patch(
            "enrollment_code.secrets.choice", side_effect=list(expected)
        ) as choice:
            generated = enrollment_code.generate_enrollment_code()

        self.assertEqual(generated, expected)
        self.assertEqual(choice.call_count, enrollment_code.CODE_LENGTH)
        self.assertTrue(enrollment_code.is_valid_enrollment_code(generated))
        self.assertNotRegex(generated, r"[01ILOU]")

    def test_normalization_accepts_spacing_hyphens_and_letter_case(self):
        self.assertEqual(
            enrollment_code.normalize_enrollment_code("7k3m-p9xr d2hf"),
            "7K3MP9XRD2HF",
        )
        self.assertEqual(
            enrollment_code.display_enrollment_code("7k3mp9xrd2hf"),
            "7K3M-P9XR-D2HF",
        )
        self.assertTrue(enrollment_code.is_valid_enrollment_code("7k3m-p9xr d2hf"))

    def test_invalid_length_or_ambiguous_characters_are_rejected(self):
        self.assertFalse(enrollment_code.is_valid_enrollment_code("7K3M"))
        self.assertFalse(enrollment_code.is_valid_enrollment_code("10IL-ABCD-EFGH"))

    def test_equivalent_display_forms_hash_identically(self):
        compact = enrollment_code.hash_enrollment_code("7K3MP9XRD2HF")
        entered = enrollment_code.hash_enrollment_code("7k3m-p9xr d2hf")
        self.assertEqual(compact, entered)


if __name__ == "__main__":
    unittest.main()
