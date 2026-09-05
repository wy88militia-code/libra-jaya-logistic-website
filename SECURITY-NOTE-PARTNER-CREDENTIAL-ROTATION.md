# Partner API Credential Rotation

If a partner API Key or API Secret is exposed in a screenshot, chat, email, or other insecure channel, treat it as compromised and rotate it before use.

For LIBRA-TEST01 created on 2026-09-05, the initially displayed API credential must not be used because it was exposed in a screenshot during setup.

Required admin behavior:
- Rotate the exposed partner API credential before API testing.
- Do not reuse the old API Key or API Secret.
- Continue deposit testing independently of API credentials; wallet deposit does not require the partner API secret.
