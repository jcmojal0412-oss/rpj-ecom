# RPJ Ecom System

A full-stack business operations MVP for an ecommerce company. Built with Next.js 14, SQLite, Tailwind CSS, and Recharts.

## Prerequisites

- **Node.js 18+** — [Download here](https://nodejs.org/)
- npm (comes with Node.js)

## Setup & Run

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The SQLite database (`rpj.db`) is created automatically on first run with seed data.

## Modules

| Route | Module |
|-------|--------|
| `/` | CEO Dashboard — KPIs, charts, low stock alerts, daily summary |
| `/inventory` | Inventory — stock in/out form, inventory table, movement log |
| `/purchase-orders` | Purchase Orders — PO list, create PO, PO detail |
| `/product-research` | Product Research — Kanban board + table view |
| `/reports` | Reports — category value chart, stock aging, shrinkage audit |

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: SQLite via `better-sqlite3` (file: `./rpj.db`)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Icons**: Lucide React
- **Drag & Drop**: @dnd-kit/core (Kanban board)

## Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
rpj-ecom/
├── app/
│   ├── api/                    # API route handlers
│   │   ├── dashboard/          # KPIs, fast/slow moving
│   │   ├── inventory/          # Inventory + summary
│   │   ├── stock-movements/    # Movement log
│   │   ├── products/           # Product CRUD
│   │   ├── purchase-orders/    # PO CRUD
│   │   └── product-research/   # Research CRUD
│   ├── inventory/
│   ├── purchase-orders/
│   ├── product-research/
│   ├── reports/
│   ├── layout.tsx              # Root layout with sidebar
│   └── page.tsx                # Dashboard homepage
├── components/
│   ├── ui/                     # Sidebar, Modal, Toast, Spinner
│   ├── dashboard/              # Dashboard components + charts
│   ├── inventory/              # Stock form, inventory table, movement log
│   ├── purchase-orders/        # PO list, create form, detail view
│   └── product-research/       # Kanban, table, form
├── lib/
│   ├── db.ts                   # SQLite singleton + schema + seed data
│   └── utils.ts                # Formatting utilities
└── rpj.db                      # Auto-created SQLite database
```
