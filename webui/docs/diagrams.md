# CB8 Flow Diagrams

These diagrams are intentionally small. They are here to help new contributors
build a mental model before diving into files.

## Renderer To API To Database

```mermaid
flowchart LR
  UI["React component\nsrc/renderer/components or pages"] --> API["renderer API helper\nsrc/renderer/lib/api/*.ts"]
  API --> HTTP["HTTP /api request"]
  HTTP --> Server["Fastify wrapper\nsrc/main/webServer/server.ts"]
  Server --> Route["Route handler\nsrc/main/webServer/routes/*.ts"]
  Route --> DB["LibraryDatabase facade\nsrc/main/libraryDatabase.ts"]
  DB --> Domain["DB domain module\nsrc/main/db/*.ts"]
  Domain --> PG["Postgres"]
```

## Upload And Ingest

Two paths get files into the library. Direct uploads stream to disk and ingest
inline; adding a server path enqueues a durable scan job that the separate
worker process executes while the UI polls for progress.

```mermaid
flowchart TD
  Upload["Admin UI: UploadPanel"] --> UploadRoute["POST /api/admin/upload\nroutes/upload.ts"]
  UploadRoute --> IngestBridge["webServer/ingest.ts\naddSingleFile"]
  AddPath["Admin UI: AddPathPanel"] --> AddPathRoute["POST /api/admin/add-path\nroutes/upload.ts"]
  AddPathRoute --> Queue["enqueueScan\njobs/producer.ts → pg-boss (Postgres)"]
  Queue --> Worker["cb8-worker\njobs/handlers.ts → handleIngestScan"]
  Worker --> IngestBridge
  IngestBridge --> Service["IngestService\nsrc/main/ingestService.ts"]
  Service --> Archive["Archive/page helpers\narchiveLoader, EPUB/PDF helpers"]
  Service --> Thumb["Thumbnail generation\nthumbnailGenerator.ts"]
  Service --> DB["Batch DB writes\nLibraryDatabase"]
  Service --> Errors["ingest_errors table\nsrc/main/db/ingestErrors.ts"]
  AddPath -. "poll GET /api/jobs/:id\nroutes/jobs.ts" .-> Worker
```

## Reader Page/Image Flow

```mermaid
flowchart LR
  ReaderPage["ReaderPage.tsx\n(lazy readers + useImmersiveChrome)"] --> FetchRecord["GET /api/comics/:id"]
  FetchRecord --> PickReader["ComicReader / EpubReader / PdfReader"]
  PickReader --> PageReq["Page or file request\n(?width= resize, ?upscale=1 HD)"]
  PageReq --> Routes["routes/comics.ts"]
  Routes --> Cache["archiveCache.ts"]
  Cache --> Loader["archiveLoader.ts"]
  Loader --> Resize["imageResizer.ts / upscaleClient.ts\noptional width + HD caches"]
  Resize --> Browser["Rendered page"]
  PickReader --> Progress["PUT /api/comics/:id/progress\nor location (CFI + % read)"]
```

## External Reader Apps (OPDS / WebPub)

```mermaid
flowchart LR
  App["OPDS reader app"] --> Feed["GET /api/opds\nroutes/opds.ts"]
  Feed --> Manifest["GET /api/comics/:id/manifest\nroutes/webpub.ts (Readium WebPub)"]
  Manifest --> Pages["page / file endpoints\nroutes/comics.ts"]
```
