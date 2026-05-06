# Requirements Document

## Introduction

This feature improves the account registration and email verification flow by allowing users to recover from failed or missed verification codes. Currently, if a user does not receive the verification email or closes the verification window, they have no way to resend the code or return to the verification step. This feature adds a resend code capability on the verification screen, spam folder messaging, and handles unverified accounts during re-registration and login attempts.

## Glossary

- **Registration_Page**: The static HTML page at `/register/index.html` that handles user sign-up, email verification, and API key display using the Cognito SDK client-side.
- **Login_Page**: The static HTML page at `/login/index.html` that handles user authentication using the Cognito SDK client-side.
- **Verification_Step**: The second step of the registration flow (element `#verify-step`) where users enter the email verification code sent by Cognito.
- **Resend_Button**: A button displayed on the Verification_Step that triggers `cognitoUser.resendConfirmationCode()` to send a new verification code to the user's email.
- **Cognito_SDK**: The `amazon-cognito-identity-js` library used client-side for user pool operations including sign-up, confirmation, resend, and authentication.
- **Unverified_Account**: A Cognito user pool account where the email address has not been confirmed via the verification code flow.

## Requirements

### Requirement 1: Display Spam Folder Advisory on Verification Step

**User Story:** As a user who has just registered, I want to see a message reminding me to check my spam folder, so that I can find the verification email if it was not delivered to my inbox.

#### Acceptance Criteria

1. WHEN the Verification_Step is displayed, THE Registration_Page SHALL show an informational message advising the user to check their spam or junk folder for the verification email.
2. WHEN the Verification_Step is displayed, THE Registration_Page SHALL render the spam folder advisory in the same rendering cycle as the Verification_Step content, requiring no additional user action or separate loading state.
3. WHILE the Verification_Step is visible, THE Registration_Page SHALL continue to display the spam folder advisory without removing or hiding it.
4. THE Registration_Page SHALL render the spam folder advisory with an ARIA role of "note" so that assistive technologies identify it as supplementary information.

### Requirement 2: Resend Verification Code from Verification Step

**User Story:** As a user who did not receive the verification email, I want to request a new verification code, so that I can complete my registration without starting over.

#### Acceptance Criteria

1. WHEN the Verification_Step has been visible for 30 seconds, THE Registration_Page SHALL display the Resend_Button.
2. WHEN the user activates the Resend_Button, THE Registration_Page SHALL call `resendConfirmationCode()` on the Cognito_SDK to send a new verification code to the registered email address.
3. WHEN the Cognito_SDK successfully resends the verification code, THE Registration_Page SHALL display a confirmation message indicating a new code has been sent, and the message SHALL remain visible for at least 10 seconds or until the user dismisses it.
4. IF the Cognito_SDK returns an error when resending the code, THEN THE Registration_Page SHALL display the error message to the user and re-enable the Resend_Button so the user may retry.
5. WHILE the resend request is in progress, THE Registration_Page SHALL disable the Resend_Button to prevent duplicate requests.
6. WHEN a resend is successful, THE Registration_Page SHALL hide the Resend_Button for 30 seconds before showing it again.
7. THE Registration_Page SHALL ensure the Resend_Button is focusable via the Tab key, activatable via Enter and Space keys, and includes a visible text label or aria-label describing the resend action.
8. IF the user has successfully resent the verification code 3 times within the current Verification_Step session, THEN THE Registration_Page SHALL disable the Resend_Button and display a message indicating the maximum number of resend attempts has been reached.

### Requirement 3: Handle Re-Registration of Unverified Account

**User Story:** As a user who previously registered but did not verify my email, I want to be able to register again with the same email and be directed to verify, so that I can complete my account setup.

#### Acceptance Criteria

1. WHEN the Cognito_SDK returns a `UsernameExistsException` during registration, THE Registration_Page SHALL disable the submit button, display a loading indicator, and call `resendConfirmationCode()` on the Cognito_SDK for the submitted email address.
2. WHEN the resend is successful after a `UsernameExistsException`, THE Registration_Page SHALL transition to the Verification_Step and focus the verification code input.
3. IF the Cognito_SDK returns an error indicating the account is already verified (e.g., the resend call fails because confirmation is complete) when resending the code after a `UsernameExistsException`, THEN THE Registration_Page SHALL display a message indicating an account with this email already exists and suggest logging in.
4. IF the Cognito_SDK returns a non-verification-related error (e.g., `LimitExceededException`, network failure, or unexpected error) when resending the code after a `UsernameExistsException`, THEN THE Registration_Page SHALL display an error message indicating the code could not be sent, re-enable the submit button, and allow the user to retry registration.
5. THE Registration_Page SHALL store the submitted email address so that the Verification_Step can use it for code confirmation.

### Requirement 4: Handle Login Attempt with Unverified Account

**User Story:** As a user who previously registered but did not verify my email, I want to be directed to verify my account when I try to log in, so that I can complete verification without re-registering.

#### Acceptance Criteria

1. WHEN the Cognito_SDK returns a `UserNotConfirmedException` during login, THE Login_Page SHALL disable the login form controls and call `resendConfirmationCode()` on the Cognito_SDK for the submitted email address.
2. WHEN the resend is successful, THE Login_Page SHALL redirect the user to the Registration_Page with a query parameter indicating verification is needed.
3. WHEN the Registration_Page loads with the verification query parameter, THE Registration_Page SHALL display the Verification_Step with the email address pre-populated for code confirmation.
4. IF the Cognito_SDK returns an error when resending the code during login, THEN THE Login_Page SHALL re-enable the login form controls and display an error message to the user with instructions to try again or contact support.
5. WHEN the resend is successful, THE Login_Page SHALL display an informational message indicating a new verification code has been sent for at least 2 seconds before redirecting to the Registration_Page.

### Requirement 5: Accessibility Compliance

**User Story:** As a user who relies on assistive technology, I want all new UI elements to be accessible, so that I can complete the verification flow independently.

#### Acceptance Criteria

1. THE Registration_Page SHALL include `aria-live="polite"` on dynamically displayed messages (resend confirmation, error messages, spam advisory).
2. THE Registration_Page SHALL ensure the Resend_Button has an `aria-label` attribute that includes the action and target (e.g., "Resend verification code to email").
3. WHEN the Verification_Step is displayed via redirect from the Login_Page, THE Registration_Page SHALL move focus to the verification code input field within 500 milliseconds of the field being rendered.
4. THE Registration_Page SHALL ensure all new interactive elements are reachable via keyboard navigation in a tab order that follows the visual layout order (top-to-bottom, left-to-right).
5. THE Registration_Page SHALL associate each inline error message with its corresponding form field using `aria-describedby`.
6. IF the verification code input field is not rendered within 2 seconds of the Verification_Step redirect, THEN THE Registration_Page SHALL move focus to the first focusable element on the page.
