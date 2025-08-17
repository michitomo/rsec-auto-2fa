# Architecture Design: Rakuten Securities 2FA Automation Extension

## 1. Overview

### 1.1. Problem

Rakuten Securities has implemented a two-factor authentication (2FA) process that requires users to log in by clicking on a sequence of two images. This 2FA code is delivered via email. This manual process of checking an email and clicking corresponding images on the login page can be cumbersome and introduces latency to the login experience.

### 1.2. Goal

The objective of this project is to create a private, special-purpose Chrome Extension to fully automate the image-based 2FA process. The solution should be secure, fast, and seamless, aiming for the lowest possible latency between the arrival of the 2FA email and the completion of the login.

## 2. High-Level Requirements

*   The system must automatically detect the 2FA image sequence from an email.
*   The system must automatically select the correct images on the Rakuten Securities login page.
*   The process must be event-driven to ensure minimal latency (i.e., avoid polling).
*   The architecture must be secure, avoiding the need to store user email credentials or use complex, permission-heavy solutions like OAuth 2.0 within the Chrome Extension.

## 3. Proposed Architecture: Real-time Push Model via Cloudflare

We will adopt a serverless, event-driven architecture that leverages Cloudflare services to act as a real-time pipeline between the user's email and the Chrome Extension.

### 3.1. Components

1.  **User's Email Client (Gmail):** Configured with a filter to automatically forward specific 2FA emails from Rakuten Securities to a dedicated email address.
2.  **Cloudflare Email Routing:** A service configured on a custom domain to receive the forwarded emails. It acts as the entry point to our automated flow.
3.  **Cloudflare Worker (Email Parser):** A serverless function triggered by Cloudflare Email Routing upon receiving a new email. Its sole responsibility is to parse the raw email content and extract the required 2FA image identifiers and their correct sequence.
4.  **Cloudflare Worker (WebSocket Host):** A serverless function that hosts a persistent WebSocket connection with the Chrome Extension.
5.  **Chrome Extension (Client):** The browser extension that runs on the user's machine. It establishes a WebSocket connection to the Cloudflare Worker and listens for 2FA data. It also contains the content script to interact with the Rakuten Securities login page.

### 3.2. Data Flow

The process is designed as a linear, real-time data flow:

```
[Rakuten Securities] -> [User's Gmail] -> (Auto-forward) -> [Cloudflare Email Routing] -> (Trigger) -> [Cloudflare Worker (Email Parser)] -> (Push via WebSocket) -> [Chrome Extension]
```

**Step-by-step Breakdown:**

1.  Rakuten Securities sends the 2FA email to the user's primary Gmail address.
2.  A pre-configured filter in Gmail immediately forwards this email to a dedicated address on a custom domain (e.g., `2fa@your-domain.com`).
3.  Cloudflare Email Routing receives the forwarded email and instantly triggers the Email Parser Worker.
4.  The Worker executes, parses the email body, and extracts the sequence of the two required images.
5.  The Worker then pushes this sequence data through the established WebSocket connection to the connected Chrome Extension client.
6.  The Chrome Extension's background script receives the data and passes it to its content script.
7.  The content script, running on the Rakuten Securities 2FA page, simulates clicks on the correct image elements in the correct order.

### 3.3. Rationale for this Architecture

This push-based, serverless model was chosen for several key advantages:

*   **Ultra-Low Latency:** Being entirely event-driven, the delay between email arrival and action is minimized to network and processing time alone, eliminating polling delays.
*   **Efficiency & Cost-Effectiveness:** The serverless nature means code only runs when an email is received, making it highly efficient and very low-cost.
*   **Security:** It obviates the need for the Chrome Extension to handle sensitive email credentials or go through a complex OAuth 2.0 flow, significantly reducing the security surface.
*   **Reliability & Scalability:** It is built on Cloudflare's robust and globally distributed infrastructure.
