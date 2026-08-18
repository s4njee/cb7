# Features Checklist — Ebook / Comic Book Reader

A checklist of features a modern ebook and comic book reader should support.
Check items off as they are implemented and verified.

## Library Management
- [ ] Add one or more library folders to scan
- [ ] Recursive folder scanning for supported files
- [ ] Automatic background rescan / watch for new files
- [ ] Manual rescan trigger
- [ ] Nested folder / series hierarchy display
- [ ] Duplicate detection
- [ ] Remove / relocate missing files gracefully
- [ ] Multiple libraries with separate roots

## Supported Formats
- [ ] CBZ / CBR / CB7 (comic archives)
- [ ] EPUB (reflowable ebooks)
- [ ] PDF
- [ ] MOBI / AZW3 (Kindle formats)
- [ ] Plain images in a folder (JPG/PNG/WEBP/AVIF)
- [ ] DjVu
- [ ] Graceful handling of corrupt / partial archives

## Metadata
- [ ] Read embedded metadata (ComicInfo.xml, EPUB OPF)
- [ ] Title, author/creator, series, volume, issue number
- [ ] Publisher, publication date, language
- [ ] Tags / genres
- [ ] Description / summary
- [ ] Online metadata scraping / matching
- [ ] Manual metadata editing
- [ ] Cover extraction and caching
- [ ] Custom cover override

## Browsing & Discovery
- [ ] Grid view with cover thumbnails
- [ ] List / detail view
- [ ] Sort (title, date added, recently read, author, series)
- [ ] Filter by tag, author, series, format, read status
- [ ] Full-text search across metadata
- [ ] Continue reading / recently read shelf
- [ ] Recently added shelf
- [ ] Collections / custom shelves
- [ ] Favorites / bookmarks at the book level

## Reading Experience — Comics
- [ ] Single page view
- [ ] Double / two-page spread view
- [ ] Webtoon / continuous vertical scroll
- [ ] Right-to-left (manga) reading direction
- [ ] Fit width / fit height / fit page / original size
- [ ] Zoom and pan
- [ ] Page pre-loading for smooth navigation
- [ ] Smart upscaling / image filtering

## Reading Experience — Ebooks
- [ ] Reflowable text rendering
- [ ] Adjustable font family and size
- [ ] Line spacing and margins
- [ ] Themes (light / dark / sepia)
- [ ] Column / paginated vs. scroll mode
- [ ] Table of contents navigation
- [ ] In-book full-text search
- [ ] Highlights, notes, annotations
- [ ] Dictionary lookup
- [ ] Text-to-speech

## Navigation & Progress
- [ ] Resume from last read position
- [ ] Per-book reading progress tracking
- [ ] Bookmarks within a book
- [ ] Page jump / slider
- [ ] Mark as read / unread
- [ ] Reading history

## Sync & Multi-Device
- [ ] Progress sync across devices
- [ ] Web server / remote access to library
- [ ] User accounts and authentication
- [ ] Per-user libraries and permissions
- [ ] OPDS feed support
- [ ] Offline download / caching

## Organization Tools
- [ ] Batch metadata editing
- [ ] Batch tagging
- [ ] Folder / smart folder rules
- [ ] Convert between formats
- [ ] Series auto-grouping by filename parsing

## Settings & Customization
- [ ] Configurable keyboard shortcuts
- [ ] Per-format reader defaults
- [ ] Thumbnail size / quality settings
- [ ] Cache size limits and clearing
- [ ] Backup / restore database
- [ ] Import / export settings

## Accessibility
- [ ] Keyboard-only navigation
- [ ] Screen reader support
- [ ] High-contrast mode
- [ ] Adjustable UI scaling

## Platform & Quality
- [ ] Cross-platform (Windows / macOS / Linux)
- [ ] Fast cold-start and library load
- [ ] Responsive UI on large libraries
- [ ] Crash recovery / safe shutdown
- [ ] Automatic updates
- [ ] Logging and error reporting
