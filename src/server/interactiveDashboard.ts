/**
 * Interactive Local Web Dashboard & Live 3D World Viewer
 * Hosts a lightweight HTTP server on http://localhost:4050 allowing users to:
 * - Walk around with the Roblox character using WASD + Space jumping at 60 FPS
 * - Orbit the camera with the mouse and zoom in/out with the scroll wheel
 * - Fire live raycasts and test physics
 * - View real-time DataModel statistics and telemetry
 * - Automatically open in the user's default browser
 */

import http from 'http';
import { exec } from 'child_process';
import { WorkspaceService } from '../runtime/services.js';
import { Workspace3dRenderer, Workspace3dRenderOptions } from '../renderer/workspace3dRenderer.js';
import { ExecutorSandbox } from '../runtime/executorSandbox.js';

export class InteractiveDashboard {
  private static server: http.Server | null = null;
  private static port: number = 4050;
  private static currentHtml: string = "";
  private static activeSandbox: ExecutorSandbox | null = null;

  public static isRunning(): boolean {
    return this.server !== null;
  }

  public static getPort(): number {
    return this.port;
  }

  public static getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  public static setHtml(html: string): void {
    this.currentHtml = html;
  }

  public static setSandbox(sandbox: ExecutorSandbox): void {
    this.activeSandbox = sandbox;
  }

  /**
   * Starts the local dashboard server on the given port (default: 4050)
   */
  public static async start(
    port: number = 4050,
    workspace?: WorkspaceService,
    options: Workspace3dRenderOptions = {},
    autoOpen: boolean = true,
    sandbox?: ExecutorSandbox
  ): Promise<{ port: number; url: string }> {
    this.port = port;
    if (sandbox) this.activeSandbox = sandbox;

    if (workspace) {
      this.currentHtml = Workspace3dRenderer.generateHtml(workspace, {
        ...options,
        interactive: true
      });
    }

    if (this.server) {
      if (autoOpen) this.openBrowser();
      return { port: this.port, url: this.getUrl() };
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || '/';

        if (url === '/' || url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.currentHtml || '<h1>RoDev Interactive Viewer Initializing...</h1>');
          return;
        }

        if (url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: "online",
            port: this.port,
            url: this.getUrl(),
            hasSandbox: this.activeSandbox !== null,
            uptime: process.uptime()
          }));
          return;
        }

        if (url === '/api/execute' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (this.activeSandbox && data.script) {
                const execResult = this.activeSandbox.execute(data.script);
                // Refresh HTML scene
                this.currentHtml = Workspace3dRenderer.generateHtml(this.activeSandbox.game.Workspace, {
                  ...options,
                  interactive: true
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: execResult.success, error: execResult.error, logs: execResult.logs }));
              } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing active sandbox or script parameter" }));
              }
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end("Not Found");
      });

      this.server.listen(this.port, () => {
        const liveUrl = this.getUrl();
        console.log(`[RoDev Interactive Dashboard] Live at: ${liveUrl}`);
        if (autoOpen) {
          this.openBrowser();
        }
        resolve({ port: this.port, url: liveUrl });
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Retry on adjacent port
          this.port += 1;
          this.server?.listen(this.port);
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Launches default browser opening the dashboard
   */
  public static openBrowser(): void {
    const url = this.getUrl();
    if (process.platform === 'win32') {
      exec(`cmd /c start ${url}`, (err) => {
        if (err) console.error("Could not launch browser:", err);
      });
    } else if (process.platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
  }

  /**
   * Stops the interactive server
   */
  public static async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          console.log("[RoDev Interactive Dashboard] Server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
