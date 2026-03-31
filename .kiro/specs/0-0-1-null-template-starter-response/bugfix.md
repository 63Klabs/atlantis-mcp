# Bugfix Requirements Document

## Introduction

When `get_template` or `get_starter_info` is called with a resource that does not exist, the controller crashes with a null reference error (`Cannot read properties of null (reading 'name')`) instead of returning a proper MCP error response. The bug occurs because the `DebugAndLog.info` logging statement in each controller's `get()` function dereferences properties on the service result (e.g., `template.name`, `starter.name`) before the error-handling catch block can intercept a `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND` error. In edge cases where the service returns null without throwing, the logging line crashes, producing an `INTERNAL_ERROR` response with a confusing "Cannot read properties of null" message instead of the intended "not found" response with available resources listed.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `get_template` is called with a non-existent template and the service result is null THEN the system crashes with "Cannot read properties of null (reading 'name')" at the `DebugAndLog.info` call in the templates controller `get()` function

1.2 WHEN `get_starter_info` is called with a non-existent starter and the service result is null THEN the system crashes with "Cannot read properties of null (reading 'name')" at the `DebugAndLog.info` call in the starters controller `get()` function

1.3 WHEN either crash occurs THEN the system returns a generic `INTERNAL_ERROR` MCP error response with message "Failed to retrieve template" or "Failed to retrieve starter" and a confusing "Cannot read properties of null" detail, instead of a specific `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND` error with available resources

### Expected Behavior (Correct)

2.1 WHEN `get_template` is called with a non-existent template and the service result is null THEN the system SHALL safely handle the null result without crashing at the logging statement and SHALL return a proper `TEMPLATE_NOT_FOUND` MCP error response

2.2 WHEN `get_starter_info` is called with a non-existent starter and the service result is null THEN the system SHALL safely handle the null result without crashing at the logging statement and SHALL return a proper `STARTER_NOT_FOUND` MCP error response

2.3 WHEN either controller's `get()` function receives a valid (non-null) result from the service THEN the system SHALL continue to log the result properties and return a successful MCP response as before

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `get_template` is called with a valid, existing template THEN the system SHALL CONTINUE TO return a successful MCP response with the full template details and log the template properties

3.2 WHEN `get_starter_info` is called with a valid, existing starter THEN the system SHALL CONTINUE TO return a successful MCP response with the full starter details and log the starter properties

3.3 WHEN `list_templates` is called THEN the system SHALL CONTINUE TO return a successful MCP response with the template list unaffected by this fix

3.4 WHEN `list_starters` is called THEN the system SHALL CONTINUE TO return a successful MCP response with the starter list unaffected by this fix

3.5 WHEN the service layer throws a `TEMPLATE_NOT_FOUND` or `STARTER_NOT_FOUND` error (the normal not-found path) THEN the system SHALL CONTINUE TO catch the error and return the appropriate not-found MCP error response with available resources listed
