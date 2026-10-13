# Galamtor 1.3.5

## A living companion you can make your own
- Added three original Galamtor companions: Самал, Тұмар and Қыран.
- Customize a companion's name, color, accessory and temperament. Choose a random look or restore the default.
- The character moves while idle, thinking and speaking, and performs a short greeting animation on request.
- Companion preferences stay in the browser profile on this device; they are not synced to an account.
- Added keyboard dismissal, clearer dialog semantics and support for composed text input.

## Sign in with ChatGPT
- Added official local OAuth/PKCE sign-in for using an eligible ChatGPT plan in Galamtor AI; no OpenAI API key is required.
- The user signs in and grants plan-use permission in the system browser. Galamtor never asks for the ChatGPT password or browser cookies.
- Access and refresh tokens stay encrypted in the operating system credential store. AI requests go directly from the local app to OpenAI only after a user action, with response storage disabled.
- The account's plan usage limit is shared. This does not replace Firebase/Google browser sign-in, and it does not enable ChatGPT plan use on the hosted website.
- Provider errors and usage-limit responses do not silently switch to a different cloud provider.

## Validation
- 71 automated tests pass; syntax checks, asset build and production dependency audit pass.
- macOS ARM64 and Intel DMG/ZIP packages build successfully.
- The companion studio and the AI settings/ChatGPT provider controls were inspected in an isolated development profile. OAuth and a real plan request require the user to sign in after installation and were not performed during QA.

The macOS packages are unsigned and not notarized because this machine has no valid Developer ID Application identity. The public download remains on the last published stable release until signing and notarization are configured. The website integration is not enabled; OpenAI requires a separate approval path for hosted/remote use.
