# VIREPS participant codes

Registration assigns one six-character code per person. Use it for both task
sessions. Register each person once and keep their registration email.

The task launcher converts lowercase to uppercase and checks length, allowed
characters and the final check character before starting. It also checks direct
study-module URLs. Task-only examples and explicit demo/simulation URLs retain
their existing test IDs. The launcher also accepts exactly `debugdemo`, `demo`
and `debug` in any capitalization; these are normalised to lowercase so their
existing debug and demo behaviour is preserved. The check detects every single-character substitution
and swap of two different characters. It cannot detect selecting somebody else's
valid code or confirm that the participant has been registered.

Clinical REDCap project 9123 retains its automatic numeric `uin` record key.
Its separate `task_code` field matches `participant_id` in task exports. Do not
rename or reuse internal record numbers.

The fixed alphabet is `ABCDEFGHJKLMNPQRSTVWXYZ23456789` (31 characters). It
excludes I, O, U, 0 and 1. For record number n, the five-character payload is the
base-31 representation, padded with leading A characters, of
`((n - 1) * 104729 + 9102473) % 28629151`. This is one-to-one for record numbers
1–28,629,151. The last character is the sum of the five zero-based alphabet
indices multiplied by positions 1–5, modulo 31. The code looks random but is
deterministic. It is not a password.

Keep the constants in `core/utils/participant-code.js` and the REDCap formulas
unchanged and in step. Examples: record 3 → LCT46Y; record 5 → LKV3VX.

Registration must have two pages, split by section. Page 1 saves contact details
and creates the numeric record. Page 2 calculates and confirms the final code.
One-page registration can calculate from REDCap's temporary public-survey record
number. The link email is triggered only after registration is complete, the
email is accepted, and the final code is present.

Run the arithmetic and typing checks with:

```sh
node --test validation/unit/participant-code.test.js
```

The participant-code check is released with the hosted task window.
