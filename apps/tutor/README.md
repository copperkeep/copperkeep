# copperkeep-tutor

Optional. Off by default, and absent from the deployment when disabled rather than
deployed and idle.

Holds the OpenAI-compatible connection and the prompt templates. It is never reachable
from the browser — the API calls it, assembles every field of the payload, and validates
whatever comes back before a learner sees it.

The payload carries a code snippet and a test failure. No display name, no user ID, no
learner history, nothing about any other learner. That is what keeps the privacy story
intact even against a cloud endpoint.

Configuration is environment-only, prefixed `COPPERKEEP_TUTOR_`.
