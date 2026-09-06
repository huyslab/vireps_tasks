"""Shared generation and validation for one-time device enrollment codes."""

import hashlib
import secrets


# Avoid characters that are easily confused when read from a tablet or handwritten.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
CODE_LENGTH = 12
CODE_GROUP_SIZE = 4


def normalize_enrollment_code(value):
    """Return the canonical form accepted by the relay."""
    if not isinstance(value, str):
        return ""
    return "".join(character for character in value.upper() if character not in " -")


def is_valid_enrollment_code(value):
    normalized = normalize_enrollment_code(value)
    return len(normalized) == CODE_LENGTH and all(
        character in CODE_ALPHABET for character in normalized
    )


def generate_enrollment_code():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def display_enrollment_code(value):
    normalized = normalize_enrollment_code(value)
    if not is_valid_enrollment_code(normalized):
        raise ValueError("Invalid enrollment code")
    return "-".join(
        normalized[index : index + CODE_GROUP_SIZE]
        for index in range(0, CODE_LENGTH, CODE_GROUP_SIZE)
    )


def hash_enrollment_code(value):
    normalized = normalize_enrollment_code(value)
    return hashlib.sha256(normalized.encode("ascii")).hexdigest()
