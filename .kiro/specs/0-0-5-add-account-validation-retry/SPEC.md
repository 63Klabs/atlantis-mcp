# Add Account Validation Retry

## Problem

When a user goes to create an account using an email and password they are asked to complete an email verification loop. If the user fails to receive the email, or if they close out of the window that accepts the code, they are unable to either resend the code or go back to enter the code.

## Proposed Solution

Allow the user to resend the code if on the verification screen (show button after 30 seconds) and provide messaging to the user to check their spam box. (this message can be done immediately)

If the user tries to register again, or sign in but they already have an account that is not verified, then resend the code and direct the user to the verification page.

Ask any follow-up questions or clarifying questions, of if there are recommendations that require input, place them in SPEC-QUESTIONS.md and the user will answer them there. All questions in SPEC-QUESTIONS.md MUST be answered before moving on to the spec driven workflow.