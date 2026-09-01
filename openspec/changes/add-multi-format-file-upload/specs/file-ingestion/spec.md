## ADDED Requirements

### Requirement: Format detected from content, not from the file name

The system SHALL determine a file's format family from its magic bytes and SHALL reject a file
whose content family disagrees with its extension. For Office Open XML packages the system SHALL
additionally cross-check the main part name found in the file header.

#### Scenario: PDF renamed to .txt

- **WHEN** a user attaches a file named `bao-cao.txt` whose content begins with `%PDF-`
- **THEN** the attachment is rejected with `FILE_UNSUPPORTED` before any parser runs

#### Scenario: DOCX renamed to .xlsx

- **WHEN** a user attaches `bang.xlsx` whose package contains `word/document.xml`
- **THEN** the attachment is rejected with `FILE_UNSUPPORTED`

#### Scenario: PNG renamed to .jpg

- **WHEN** a user attaches `anh.jpg` whose content is a PNG
- **THEN** the image is accepted and labelled `image/png`, because the media type sent to the
  model is derived from content and therefore always matches what is actually sent

### Requirement: Bounded decompression

The system SHALL enforce an explicit ceiling on bytes produced by decompression, per entry and
per archive, and SHALL abort decompression when a ceiling is reached rather than after allocating.

#### Scenario: Zip bomb

- **WHEN** an attached `.xlsx` contains an entry that expands beyond the per-entry ceiling
- **THEN** extraction fails with `DOCUMENT_EXTRACTION_FAILED` and no allocation exceeds the ceiling

### Requirement: Legacy Word text comes from the piece table

Text extracted from a `.doc` file SHALL be assembled by following the document's piece table.
Field instructions SHALL be discarded and only field results retained.

#### Scenario: Deleted content left in the file

- **WHEN** a `.doc` stream contains orphaned text pieces not referenced by the piece table
- **THEN** that text does not appear in the extraction result

#### Scenario: Hyperlink field

- **WHEN** a paragraph contains a field whose instruction holds an internal URL
- **THEN** the extracted text contains the field result and not the URL

### Requirement: Spreadsheet and presentation structure is preserved

Extraction SHALL label each sheet by name and each slide by its presentation position, SHALL keep
cells aligned to their columns, and SHALL take slide order from the presentation's own slide list
rather than from part file names.

#### Scenario: Sparse row

- **WHEN** a spreadsheet row has values only in the third and fifth columns
- **THEN** the extracted row keeps two leading empty cells so values stay under their headers

#### Scenario: Reordered slides

- **WHEN** slides were reordered so that `slide3.xml` appears first in the presentation
- **THEN** it is extracted as `Slide 1`

### Requirement: Date cells are extracted as dates, not as serial numbers

A spreadsheet cell whose number format is a date or time format SHALL be extracted as an ISO
date string. A cell holding the same value without a date format SHALL be extracted unchanged.

#### Scenario: Signing date column

- **WHEN** a cell under the heading "Ngày ký" holds the serial `45678` with a date format
- **THEN** it is extracted as `2025-01-21`, not as `45678`

#### Scenario: Same value, no date format

- **WHEN** a cell holds `45678` with a general number format
- **THEN** it is extracted as `45678`

#### Scenario: Text prefix that looks like a date pattern

- **WHEN** a cell's custom format code is `"Ngày "0`
- **THEN** the cell is treated as a number, because the date letters are inside a text literal

### Requirement: Image metadata is removed before the image leaves the machine

The system SHALL remove EXIF, XMP and comment blocks from an image before encoding it for the
model. If metadata cannot be removed, the system SHALL NOT send the image.

#### Scenario: Photo carrying GPS EXIF

- **WHEN** a user attaches a JPEG containing an EXIF block
- **THEN** the bytes encoded for the model contain no EXIF block

#### Scenario: Malformed image container

- **WHEN** metadata removal fails because the container is corrupt
- **THEN** extraction fails and the original bytes are not sent

### Requirement: Images require an explicitly vision-capable model

The system SHALL send an image only to a model the user has marked as able to read images. This
check SHALL be separate from the document-allowlist permission check, and SHALL default to
refusing.

#### Scenario: Model not marked

- **WHEN** a user attaches an image with a model whose `supportsVision` is false
- **THEN** the turn fails with `MODEL_DOES_NOT_SUPPORT_IMAGES` before any request is sent

#### Scenario: Text-only attachment on a text-only model

- **WHEN** a user attaches a spreadsheet with a model whose `supportsVision` is false
- **THEN** the turn proceeds

### Requirement: An image that does not fit the context is an error

The system SHALL NOT silently omit an image from the context. When the remaining context budget
cannot hold an image, the turn SHALL fail with `IMAGE_EXCEEDS_CONTEXT`.

#### Scenario: Small context window

- **WHEN** the estimated image cost exceeds the available context budget
- **THEN** the turn fails and no request is sent to the model

### Requirement: Images are never persisted

The system SHALL NOT write image bytes, in any encoding, to the local store. Attachment metadata
for an image SHALL record file name, size, source path hash and dimensions only.

#### Scenario: Image attached with extracted-text storage enabled

- **WHEN** `storeExtractedText` is enabled and a user attaches an image
- **THEN** no image content is written to the attachments table
