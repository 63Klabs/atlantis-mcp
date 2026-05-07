# Password Validator Module

Client-side password re-entry confirmation and Cognito password policy validation. Zero runtime dependencies, framework-agnostic, pure functions only.

## Features

- Password match validation (exact, case-sensitive comparison)
- Cognito User Pool password policy validation
- Real-time validation feedback with structured results
- WCAG 2.1 AA accessibility attribute generation
- Form submission gating for `cognito.signUp()` calls
- Focus management guidance for error recovery

## Installation

Copy `password-validator.js` into your project or reference it directly:

```javascript
const {
  validateMatch,
  validatePolicy,
  validateForm,
  getAriaAttributes,
  getAriaLiveRegion,
  isReadyForSubmission,
  getFirstErrorField,
  FIELD_IDS,
  POLICY_RULES
} = require('./utils/password-validator');
```

## API Reference

### `validateMatch(password, confirmPassword)`

Performs exact, case-sensitive comparison of two password values. No trimming or whitespace normalization is applied.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| password | `string\|null\|undefined` | Yes | Primary password value |
| confirmPassword | `string\|null\|undefined` | Yes | Confirmation password value |

**Returns:** `{isValid: boolean, error: string|null}`

| Condition | isValid | error |
|-----------|---------|-------|
| Both identical non-empty strings | `true` | `null` |
| password is empty/null/undefined | `false` | `'MISSING_PASSWORD'` |
| confirmPassword is empty/null/undefined | `false` | `'MISSING_CONFIRM_PASSWORD'` |
| Values differ | `false` | `'PASSWORDS_DO_NOT_MATCH'` |

**Example:**

```javascript
const { validateMatch } = require('./utils/password-validator');

validateMatch('Secret1!', 'Secret1!');
// { isValid: true, error: null }

validateMatch('Secret1!', 'secret1!');
// { isValid: false, error: 'PASSWORDS_DO_NOT_MATCH' }

validateMatch(null, 'Secret1!');
// { isValid: false, error: 'MISSING_PASSWORD' }
```

---

### `validatePolicy(password)`

Validates a password against the Cognito User Pool password policy. Returns an array of violation identifiers for each rule the password fails.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| password | `string\|null\|undefined` | Yes | Password value to validate |

**Returns:** `string[]` — Array of violation identifiers (empty array when valid)

**Violation identifiers:**

| Identifier | Rule |
|------------|------|
| `'REQUIRED'` | Password is null, undefined, or empty string |
| `'MIN_LENGTH'` | Fewer than 8 characters |
| `'MAX_LENGTH'` | More than 256 characters |
| `'UPPERCASE_REQUIRED'` | No uppercase letter (A-Z) |
| `'LOWERCASE_REQUIRED'` | No lowercase letter (a-z) |
| `'NUMBER_REQUIRED'` | No digit (0-9) |
| `'SYMBOL_REQUIRED'` | No symbol from: `^ $ * . [ ] { } ( ) ? " ! @ # % & / \ , > < ' : ; \| _ ~ \` = + -` |

**Example:**

```javascript
const { validatePolicy } = require('./utils/password-validator');

validatePolicy('StrongP@ss1');
// []

validatePolicy('weak');
// ['MIN_LENGTH', 'UPPERCASE_REQUIRED', 'NUMBER_REQUIRED', 'SYMBOL_REQUIRED']

validatePolicy(null);
// ['REQUIRED']
```

---

### `validateForm(password, confirmPassword)`

Combined real-time validation for both fields. Designed to be called on every input event. Suppresses mismatch errors when the confirm field is empty (user hasn't started typing).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| password | `string` | Yes | Current password field value |
| confirmPassword | `string` | Yes | Current confirm-password field value |

**Returns:** `{isValid: boolean, errors: string[], fieldErrors: Object.<string, string[]>}`

- `isValid` — `true` only when `errors` is empty
- `errors` — Array of human-readable error message strings (max 10 entries)
- `fieldErrors` — Maps field names (`'password'`, `'confirm-password'`) to their specific error arrays

**Behavior:**

| Condition | Result |
|-----------|--------|
| Both fields empty | `{isValid: true, errors: [], fieldErrors: {}}` |
| Password has policy violations | Violations listed in `fieldErrors.password` |
| confirmPassword is empty | No mismatch error reported |
| confirmPassword is non-empty and differs | Mismatch error in `fieldErrors['confirm-password']` |

**Example:**

```javascript
const { validateForm } = require('./utils/password-validator');

validateForm('Str0ng!Pass', 'Str0ng!Pass');
// { isValid: true, errors: [], fieldErrors: {} }

validateForm('weak', '');
// {
//   isValid: false,
//   errors: ['Password must be at least 8 characters', ...],
//   fieldErrors: { password: ['Password must be at least 8 characters', ...] }
// }

validateForm('Str0ng!Pass', 'different');
// {
//   isValid: false,
//   errors: ['Passwords do not match'],
//   fieldErrors: { 'confirm-password': ['Passwords do not match'] }
// }
```

---

### `getAriaAttributes(validationResult, fieldName)`

Generates ARIA attributes for a specific field based on validation state.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| validationResult | `object\|null\|undefined` | Yes | Result from `validateForm()` |
| fieldName | `string` | Yes | Either `'password'` or `'confirm-password'` |

**Returns:** `{ariaDescribedby: string, ariaRequired: string, ariaInvalid: string}`

| Field | ariaDescribedby value |
|-------|----------------------|
| `'password'` | `'password-requirements'` |
| `'confirm-password'` | `'password-match-status'` |

- `ariaRequired` — Always `"true"`
- `ariaInvalid` — `"true"` if field has errors, `"false"` otherwise
- Returns safe defaults (`ariaInvalid: "false"`) when validationResult is null/undefined/non-object

**Example:**

```javascript
const { validateForm, getAriaAttributes } = require('./utils/password-validator');

const result = validateForm('weak', '');
const attrs = getAriaAttributes(result, 'password');
// { ariaDescribedby: 'password-requirements', ariaRequired: 'true', ariaInvalid: 'true' }

const safeAttrs = getAriaAttributes(null, 'password');
// { ariaDescribedby: 'password-requirements', ariaRequired: 'true', ariaInvalid: 'false' }
```

---

### `getAriaLiveRegion(validationResult)`

Generates content for the ARIA live region announcement.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| validationResult | `object\|null\|undefined` | Yes | Result from `validateForm()` |

**Returns:** `{ariaLive: string, content: string}`

- `ariaLive` — Always `"polite"`
- `content` — All current error messages joined with spaces, or empty string when no errors
- Returns `{ariaLive: "polite", content: ""}` when validationResult is null/undefined/non-object

**Example:**

```javascript
const { validateForm, getAriaLiveRegion } = require('./utils/password-validator');

const result = validateForm('weak', '');
const liveRegion = getAriaLiveRegion(result);
// {
//   ariaLive: 'polite',
//   content: 'Password must be at least 8 characters Password must contain at least one uppercase letter ...'
// }

getAriaLiveRegion(null);
// { ariaLive: 'polite', content: '' }
```

---

### `isReadyForSubmission(password, confirmPassword)`

Single boolean gate for form submission. Use this to guard `cognito.signUp()` calls.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| password | `string\|null\|undefined` | Yes | Password value |
| confirmPassword | `string\|null\|undefined` | Yes | Confirm-password value |

**Returns:** `boolean`

Returns `true` only when:
1. Password passes all Cognito policy rules
2. Both values match exactly
3. Neither value is null, undefined, or empty

**Example:**

```javascript
const { isReadyForSubmission } = require('./utils/password-validator');

isReadyForSubmission('StrongP@ss1', 'StrongP@ss1');
// true

isReadyForSubmission('weak', 'weak');
// false (policy violations)

isReadyForSubmission('StrongP@ss1', 'Different1!');
// false (mismatch)

isReadyForSubmission('StrongP@ss1', null);
// false (missing confirm)
```

---

### `getFirstErrorField(validationResult)`

Returns the DOM element ID of the first field with a validation error. Use this for focus management on failed submission attempts.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| validationResult | `object\|null\|undefined` | Yes | Result from `validateForm()` |

**Returns:** `string|null`

**Priority order:**
1. Password field errors → returns `'password-input'`
2. Confirm-password field errors → returns `'confirm-password-input'`
3. No errors → returns `null`

**Example:**

```javascript
const { validateForm, getFirstErrorField } = require('./utils/password-validator');

const result1 = validateForm('weak', 'weak');
getFirstErrorField(result1);
// 'password-input' (password has policy errors)

const result2 = validateForm('StrongP@ss1', 'Different1!');
getFirstErrorField(result2);
// 'confirm-password-input' (only confirm has mismatch error)

const result3 = validateForm('StrongP@ss1', 'StrongP@ss1');
getFirstErrorField(result3);
// null (no errors)
```

---

### Constants

#### `FIELD_IDS`

DOM element IDs used by the validation UI:

```javascript
const FIELD_IDS = {
  password: 'password-input',
  confirmPassword: 'confirm-password-input',
  passwordDescription: 'password-requirements',
  matchStatus: 'password-match-status'
};
```

#### `POLICY_RULES`

Cognito User Pool password policy configuration:

```javascript
const POLICY_RULES = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 256,
  UPPERCASE_PATTERN: /[A-Z]/,
  LOWERCASE_PATTERN: /[a-z]/,
  NUMBER_PATTERN: /[0-9]/,
  SYMBOL_PATTERN: /[\^$*.\[\]{}()?"!@#%&/\\,><':;|_~`=+\-]/
};
```

---

## Integration Examples

### AWS Amplify Auth.signUp()

Complete flow showing validation before calling Amplify's `Auth.signUp()`:

```javascript
import { Auth } from 'aws-amplify';
const {
  validateForm,
  isReadyForSubmission,
  getFirstErrorField,
  getAriaAttributes,
  getAriaLiveRegion
} = require('./utils/password-validator');

// Wire validation to input events for real-time feedback
function onPasswordInput(event) {
  const password = document.getElementById('password-input').value;
  const confirmPassword = document.getElementById('confirm-password-input').value;

  const result = validateForm(password, confirmPassword);

  // Update ARIA attributes on fields
  const passwordAttrs = getAriaAttributes(result, 'password');
  const confirmAttrs = getAriaAttributes(result, 'confirm-password');

  const passwordInput = document.getElementById('password-input');
  passwordInput.setAttribute('aria-invalid', passwordAttrs.ariaInvalid);
  passwordInput.setAttribute('aria-describedby', passwordAttrs.ariaDescribedby);

  const confirmInput = document.getElementById('confirm-password-input');
  confirmInput.setAttribute('aria-invalid', confirmAttrs.ariaInvalid);
  confirmInput.setAttribute('aria-describedby', confirmAttrs.ariaDescribedby);

  // Update live region for screen reader announcements
  const liveRegion = getAriaLiveRegion(result);
  document.getElementById('validation-announcements').textContent = liveRegion.content;
}

// Gate form submission on validation
async function handleSignUp(event) {
  event.preventDefault();

  const username = document.getElementById('username-input').value;
  const password = document.getElementById('password-input').value;
  const confirmPassword = document.getElementById('confirm-password-input').value;

  // Validate before calling signUp
  if (!isReadyForSubmission(password, confirmPassword)) {
    const result = validateForm(password, confirmPassword);
    const firstErrorId = getFirstErrorField(result);

    if (firstErrorId) {
      document.getElementById(firstErrorId).focus();
    }
    return; // Do not call signUp
  }

  try {
    const { user } = await Auth.signUp({
      username,
      password,
      attributes: { email: username }
    });
    // Handle successful sign-up
  } catch (error) {
    // Handle Cognito errors (e.g., username already exists)
    console.error('Sign-up error:', error);
  }
}
```

---

### AWS SDK CognitoIdentityProviderClient.signUp()

Complete flow using the AWS SDK v3 `CognitoIdentityProviderClient`:

```javascript
import {
  CognitoIdentityProviderClient,
  SignUpCommand
} from '@aws-sdk/client-cognito-identity-provider';

const {
  validateForm,
  isReadyForSubmission,
  getFirstErrorField
} = require('./utils/password-validator');

const cognitoClient = new CognitoIdentityProviderClient({
  region: 'us-east-1'
});

async function handleSignUp(username, password, confirmPassword) {
  // Validate before calling signUp
  if (!isReadyForSubmission(password, confirmPassword)) {
    const result = validateForm(password, confirmPassword);
    const firstErrorId = getFirstErrorField(result);

    // Return validation failure to the caller
    return {
      success: false,
      validationResult: result,
      focusFieldId: firstErrorId
    };
  }

  try {
    const command = new SignUpCommand({
      ClientId: 'your-user-pool-client-id',
      Username: username,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: username }
      ]
    });

    const response = await cognitoClient.send(command);

    return {
      success: true,
      userSub: response.UserSub,
      codeDeliveryDetails: response.CodeDeliveryDetails
    };
  } catch (error) {
    return {
      success: false,
      error: error.name,
      message: error.message
    };
  }
}
```

---

## WCAG 2.1 AA Compliant HTML Structure

The following HTML structure provides the element IDs and ARIA relationships expected by the module's accessibility functions.

```html
<form id="signup-form" novalidate>
  <!-- Password field -->
  <div class="field-group">
    <label for="password-input">Password</label>
    <input
      type="password"
      id="password-input"
      name="password"
      aria-required="true"
      aria-invalid="false"
      aria-describedby="password-requirements"
      autocomplete="new-password"
    />
    <div id="password-requirements" class="field-description">
      Password must be at least 8 characters and include an uppercase letter,
      a lowercase letter, a number, and a symbol.
    </div>
  </div>

  <!-- Confirm password field -->
  <div class="field-group">
    <label for="confirm-password-input">Confirm password</label>
    <input
      type="password"
      id="confirm-password-input"
      name="confirm-password"
      aria-required="true"
      aria-invalid="false"
      aria-describedby="password-match-status"
      autocomplete="new-password"
    />
    <div id="password-match-status" class="field-description">
      Re-enter your password to confirm.
    </div>
  </div>

  <!-- ARIA live region for validation announcements -->
  <div
    id="validation-announcements"
    aria-live="polite"
    aria-atomic="true"
    class="visually-hidden"
  ></div>

  <button type="submit">Create account</button>
</form>
```

### Required element IDs

| Element ID | Purpose | Used by |
|------------|---------|---------|
| `password-input` | Password input field | `getFirstErrorField()` |
| `confirm-password-input` | Confirm password input field | `getFirstErrorField()` |
| `password-requirements` | Password policy description | `getAriaAttributes(result, 'password')` |
| `password-match-status` | Match status description | `getAriaAttributes(result, 'confirm-password')` |
| `validation-announcements` | Live region for screen readers | `getAriaLiveRegion()` |

### ARIA relationships

- Each input has `aria-describedby` pointing to its description element
- Each input has `aria-required="true"` (always)
- Each input has `aria-invalid` toggled by validation state
- The live region uses `aria-live="polite"` so announcements don't interrupt the user
- The live region uses `aria-atomic="true"` so the full content is announced on change

### Visually hidden class (for live region)

```css
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

---

## Validation Failure Return Value Structure

When validation fails, the module returns structured data that tells you exactly what went wrong and where.

### `validateForm()` failure structure

```javascript
{
  isValid: false,
  errors: [
    'Password must be at least 8 characters',
    'Password must contain at least one uppercase letter',
    'Passwords do not match'
  ],
  fieldErrors: {
    'password': [
      'Password must be at least 8 characters',
      'Password must contain at least one uppercase letter'
    ],
    'confirm-password': [
      'Passwords do not match'
    ]
  }
}
```

**Field breakdown:**

| Field | Type | Description |
|-------|------|-------------|
| `isValid` | `boolean` | `false` when any errors exist |
| `errors` | `string[]` | Flat array of all error messages (max 10) |
| `fieldErrors` | `object` | Maps field names to their specific error arrays |
| `fieldErrors.password` | `string[]` | Policy violation messages for the password field |
| `fieldErrors['confirm-password']` | `string[]` | Mismatch message for the confirm field |

### `validateMatch()` failure structure

```javascript
{ isValid: false, error: 'PASSWORDS_DO_NOT_MATCH' }
```

| Field | Type | Description |
|-------|------|-------------|
| `isValid` | `boolean` | `false` when passwords don't match or are missing |
| `error` | `string` | Error identifier constant |

### Error message constants

The module uses these constant identifiers internally. Frontend consumers map them to localized display strings:

| Identifier | Display message |
|------------|----------------|
| `REQUIRED` | Password is required |
| `MIN_LENGTH` | Password must be at least 8 characters |
| `MAX_LENGTH` | Password must be at most 256 characters |
| `UPPERCASE_REQUIRED` | Password must contain at least one uppercase letter |
| `LOWERCASE_REQUIRED` | Password must contain at least one lowercase letter |
| `NUMBER_REQUIRED` | Password must contain at least one number |
| `SYMBOL_REQUIRED` | Password must contain at least one symbol |
| `PASSWORDS_DO_NOT_MATCH` | Passwords do not match |
| `MISSING_PASSWORD` | Password is required |
| `MISSING_CONFIRM_PASSWORD` | Please confirm your password |

---

## Related Resources

- [Cognito User Pool Password Policy](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-policies.html)
- [WCAG 2.1 AA Success Criteria](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Live Regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions)
