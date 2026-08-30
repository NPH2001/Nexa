## ADDED Requirements

### Requirement: Versioned checklist result

The system SHALL evaluate a case with a pinned checklist template and rule-pack version. Each
result SHALL identify the rule, status, evidence and remediation. The system SHALL NOT describe
the overall case as approved, valid or complete.

#### Scenario: Same evidence and versions

- **WHEN** the same normalized evidence is reviewed twice with the same template and rule pack
- **THEN** the ordered checklist result is identical

### Requirement: Extraction cannot decide

The extraction model SHALL only return structured document classification and fields. Checklist
status SHALL be produced by deterministic code.

#### Scenario: Uncertain field

- **WHEN** a required extracted field has `needsReview=true`
- **THEN** the requirement is `needs_review`, not `passed` or `missing`

### Requirement: Internal-only document processing

Bank document content SHALL only be sent through the internal LiteLLM provider. Raw source text,
file names and findings SHALL NOT be written to logs.

#### Scenario: External model is configured

- **WHEN** extraction resolves an external provider
- **THEN** extraction fails before invoking that provider

### Requirement: No raw file persistence

The system SHALL persist encrypted extracted evidence and safe metadata but SHALL NOT persist a
copy of the selected file, its path or extracted raw text.
