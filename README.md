# Collaborative Docx

A premium collaborative document editor built for clarity, elegance, and real-time teamwork. Featuring CRDT-powered sync, Google Docs-style live cursors, version history, and a distraction-free writing experience.

![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?logo=supabase&logoColor=white)
![TipTap](https://img.shields.io/badge/TipTap-2.11-1a1a2e)
![Yjs](https://img.shields.io/badge/Yjs-CRDT-6C3FC5)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)

---

## Features

### Editor

- **Rich Text Editing** — Bold, italic, underline, strikethrough, superscript, subscript, headings (H1–H6), blockquotes, code blocks, horizontal rules
- **Text Alignment** — Left, center, right, and justify
- **Text Styling** — Font color palette, highlight, text transform (uppercase/lowercase/capitalize)
- **Layout Controls** — Document-level line spacing presets and document border styles
- **Lists** — Ordered, unordered, and interactive task lists with checkboxes
- **Tables** — Insert and edit tables with configurable rows, columns, and header rows
- **Links** — Insert, edit, and remove hyperlinks with a popover UI
- **Typography** — Smart quotes, em dashes, and typographic enhancements powered by TipTap
- **Media Embeds** — Upload images and videos directly into documents from the toolbar
- **Image Paste** — Paste images from clipboard directly into the editor
- **Secure Media URLs** — Uploaded media can use signed Supabase Storage URLs with automatic refresh before expiry

### Real-Time Collaboration (Yjs CRDT)

- **Conflict-Free Editing** — Powered by [Yjs](https://yjs.dev) CRDT — multiple users can type simultaneously with zero conflicts
- **Google Docs-Style Cursors** — Inline colored carets with user name labels rendered directly in the text flow
- **Incremental Binary Sync** — Only tiny binary diffs (~50–200 bytes) are transmitted per keystroke, not full HTML documents
- **Per-User Undo/Redo** — Each collaborator has their own undo stack — undoing your changes won't undo someone else's
- **User Presence** — Active user avatars with idle/active indicators shown in the document header
- **Awareness Protocol** — Cursor positions and user identity synced via `y-protocols/awareness`
- **Document Sharing** — Generate share links with view or edit permissions
- **Password Protection** — Optionally password-protect shared documents
- **Comments** — Thread-based commenting with real-time sync via Supabase postgres_changes
- **Persistent State** — Yjs CRDT state stored as base64 in the database; HTML `content` column kept in sync for exports and legacy access

### Productivity

- **Find & Replace** — Search with regex and case-sensitive matching (`Ctrl+Shift+H`)
- **Document Outline** — Auto-generated heading navigation for long documents
- **Writing Goals** — Set word count targets and track streaks
- **Word Frequency** — Bar chart of the top 20 most-used words
- **Pomodoro Timer** — Built-in 25/5/15 timer in the status bar
- **Keyboard Shortcuts** — Comprehensive reference panel accessible from the status bar
- **Import** — Upload and convert `.docx`, `.txt`, `.md`, `.html`, and `.rtf` files into editable documents

### Writing Modes

- **Focus Mode** — Dims non-active paragraphs (`Ctrl+Shift+F`)
- **Zen Mode** — Full-screen, distraction-free writing

### Document Management

- **Document Border Presets** — None, thin, medium, thick, and accent border styles
- **Folders** — Create folders, filter documents by folder, and quickly create docs directly inside a folder
- **Move & Copy** — Right-click context menu (desktop) or ⋯ dropdown button (mobile/touch) to move or copy documents between folders
- **Version History** — Snapshots saved to database on manual save; preview, compare, and restore any version
- **Export** — Download or copy as HTML, Markdown, Plain Text, or JSON
- **Download by Code** — Generate a 6-character code per document and download it from `/download` on any device
- **Code Expiry** — Download codes expire automatically after 24 hours
- **Code Download Formats** — Download by code as `.pdf`, `.docx`, `.md`, or `.txt`
- **Direct PDF Generation** — PDF files are generated directly in-app (no browser print dialog)
- **Folder Download by Code** — Generate a unique folder code and download all folder docs in one `.zip` from `/download-folder`
- **Auto-Save** — Debounced autosave for content and document border style
- **Manual Save** — `Ctrl+S` or the Save button to explicitly save and create a version snapshot

### Authentication

- **Email/Password Auth** — Standard sign-up and sign-in
- **Google OAuth** — Branded Google sign-in button with redirect callback handling
- **Shared Access Rules** — View-only and edit sharing with optional password protection

### SEO & Performance

- **Dynamic Meta Tags** — Per-page title, description, Open Graph, and Twitter Card tags via `react-helmet-async`
- **Structured Data** — JSON-LD schema for WebApplication
- **robots.txt & Sitemap** — Proper crawl directives for public and private routes
- **Canonical URLs** — Automatic canonical link tags on every page

---

## Tech Stack

| Layer             | Technology                                    |
| ----------------- | --------------------------------------------- |
| **Framework**     | React 18.3 + TypeScript 5.5                   |
| **Build**         | Vite 5.4 (SWC)                                |
| **Editor**        | TipTap 2.11 with 17+ extensions               |
| **Collaboration** | Yjs CRDT + y-prosemirror + y-protocols         |
| **Styling**       | Tailwind CSS 3.4 + Shadcn UI + Framer Motion  |
| **Backend**       | Supabase (Auth, PostgreSQL, Realtime, RLS)     |
| **Storage**       | Supabase Storage (document media uploads)       |
| **State**         | TanStack React Query 5                         |
| **Routing**       | React Router 6                                 |
| **SEO**           | react-helmet-async                             |
| **Charts**        | Recharts                                       |

---

## Collaboration Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User A's Browser                  │
│  Tiptap Editor ←→ Y.Doc (CRDT) ←→ SupabaseProvider │
│                                   ↕ Awareness       │
└──────────────────────┬──────────────────────────────┘
                       │ Supabase Realtime Broadcast
                       │ • yjs-update (binary diffs)
                       │ • yjs-awareness (cursors)
                       │ • yjs-sync-request/response
┌──────────────────────┴──────────────────────────────┐
│                   User B's Browser                  │
│  Tiptap Editor ←→ Y.Doc (CRDT) ←→ SupabaseProvider │
│                                   ↕ Awareness       │
└─────────────────────────────────────────────────────┘
                       │
                       ↓ Debounced persist (every 2s)
              ┌────────────────┐
              │  Supabase DB   │
              │  yjs_state     │ ← base64 CRDT state
              │  content       │ ← HTML for exports
              └────────────────┘
```

---

## Database Schema

```
documents             — id, title, content, yjs_state, document_border_style, tags, folder_id, deleted_at, created_by, status, parent_id, is_template
comments              — id, document_id, content, created_by
document_shares       — id, document_id, share_token, permission_level, password_hash
document_versions     — id, document_id, content, word_count, char_count, created_by
document_download_codes — id, document_id, code, created_by, expires_at
folders               — id, name, created_by, created_at, updated_at
folder_download_codes — id, folder_id, code, created_by, expires_at
```

All tables use **Row Level Security (RLS)** — users can only access their own documents and documents shared with them.

---

## Getting Started

### Prerequisites

- **Node.js** 18+
- **npm** or **bun**
- A [Supabase](https://supabase.com) project

### 1. Clone the repository

```bash
git clone https://github.com/umeshgupta05/Collaborative-Docx.git
cd Collaborative-Docx
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
# Optional: set to false to force public media URLs instead of signed URLs
VITE_MEDIA_USE_SIGNED_URLS=true
```

### 3.1 Create Storage bucket for editor media

Create a Supabase Storage bucket named `document-media`.

Recommended setup:

- Private bucket (preferred for sensitive docs)
- Add storage policies that allow authenticated collaborators to upload/read objects
- If using private bucket, keep `VITE_MEDIA_USE_SIGNED_URLS=true` for signed delivery URLs

If you use a public bucket, the editor will still work via public URL fallback.

### 4. Set up the database

Option A — Using Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
```

Option B — Run the migration SQL files manually in the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql):

- `supabase/migrations/20260306172511_*.sql`
- `supabase/migrations/20260312000000_create_document_versions.sql`
- `supabase/migrations/20260317120000_add_productivity_and_collab_features.sql`
- `supabase/migrations/20260318101000_add_document_border_style.sql`
- `supabase/migrations/20260330113000_add_document_download_codes.sql`
- `supabase/migrations/20260330124500_enforce_24h_download_code_expiry.sql`
- `supabase/migrations/20260331090000_add_folders_and_folder_download_codes.sql`
- `supabase/migrations/20260404060000_add_yjs_state_column.sql`

### 4.1 Configure Google OAuth (optional)

1. In Supabase, enable Google under **Authentication -> Providers** and set Google Client ID/Secret.
2. In Google Cloud OAuth client, add this **Authorized redirect URI**:

```text
https://<your-project-ref>.supabase.co/auth/v1/callback
```

3. In Supabase **Authentication -> URL Configuration**, add your app auth URLs (for example):

- `http://localhost:5173/auth`
- `https://your-production-domain/auth`

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Project Structure

```
src/
├── components/
│   ├── ui/              # Shadcn UI primitives
│   ├── DocumentEditor   # Core TipTap editor with Yjs collaboration
│   ├── EditorToolbar    # Formatting buttons and panel toggles
│   ├── EditorStatusBar  # Word count, timer, mode indicators
│   ├── Comments         # Real-time document commenting
│   ├── DocumentList     # Dashboard document grid with context+dropdown menus
│   ├── DocumentShareDialog
│   ├── ExportDocument   # Multi-format export
│   ├── FindReplace      # Search and replace
│   ├── KeyboardShortcuts
│   ├── LinkInsert       # Hyperlink popover
│   ├── TableInsert      # Table configuration dialog
│   ├── Media upload      # Image/video upload buttons in toolbar
│   ├── VersionHistory   # Database-backed version snapshots
│   ├── WordFrequency    # Word usage analytics
│   ├── WritingGoals     # Word count goal tracking
│   ├── DocumentOutline  # Heading-based navigation
│   ├── PomodoroTimer    # Focus timer
│   └── SEO              # Dynamic meta tags
├── lib/
│   └── SupabaseProvider # Custom Yjs provider over Supabase Realtime
├── styles/
│   └── collaboration-cursors.css # Google Docs-style cursor CSS
├── pages/
│   ├── Index            # Landing page
│   ├── Auth             # Sign in / Sign up
│   ├── Dashboard        # Document management
│   ├── Document         # Editor view (creates Y.Doc + provider)
│   ├── SharedDocument   # Shared document view (Yjs-enabled)
│   ├── DownloadByCode   # Code-based document download page
│   ├── DownloadFolderByCode # Folder-code based zip download page
│   └── NotFound         # 404
├── hooks/               # Custom React hooks
├── utils/               # Helpers (password, version)
├── extensions/          # Custom TipTap extensions (line-height)
│   └── video.ts          # Custom TipTap video node
└── integrations/        # Supabase client and types
```

---

## Scripts

| Command           | Description              |
| ----------------- | ------------------------ |
| `npm run dev`     | Start development server |
| `npm run build`   | Production build         |
| `npm run preview` | Preview production build |
| `npm run lint`    | Run ESLint               |

---

## Keyboard Shortcuts

| Shortcut       | Action                         |
| -------------- | ------------------------------ |
| `Ctrl+S`       | Save document + create version |
| `Ctrl+Shift+F` | Toggle Focus Mode              |
| `Ctrl+Shift+H` | Toggle Find & Replace          |
| `Ctrl+B`       | Bold                           |
| `Ctrl+I`       | Italic                         |
| `Ctrl+U`       | Underline                      |
| `Ctrl+Shift+X` | Strikethrough                  |
| `Ctrl+Z`       | Undo (per-user with Yjs)       |
| `Ctrl+Shift+Z` | Redo (per-user with Yjs)       |
| `Escape`       | Exit Zen Mode                  |

---

## License

This project is open source under the [MIT License](LICENSE).
