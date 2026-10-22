/**
 * Playwright Headless Engine & Visual Diffing Diagnostics
 * Captures pixel-perfect screenshots, dispatches synthetic inputs,
 * audits layout and text clipping, and computes visual pixel diffs.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { DEVICE_PRESETS } from './guiDomTranslator.js';
export class PlaywrightEngine {
    static browserInstance = null;
    static async getBrowser() {
        if (!this.browserInstance) {
            this.browserInstance = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
        }
        return this.browserInstance;
    }
    static async close() {
        if (this.browserInstance) {
            await this.browserInstance.close();
            this.browserInstance = null;
        }
    }
    /**
     * Render HTML string and capture screenshot + diagnostics
     */
    static async renderAndDiagnose(html, presetName = "desktop_1080p", outputPath) {
        const browser = await this.getBrowser();
        const preset = DEVICE_PRESETS[presetName] || DEVICE_PRESETS.desktop_1080p;
        const page = await browser.newPage({
            viewport: { width: preset.width, height: preset.height },
            deviceScaleFactor: 1
        });
        try {
            await page.setContent(html, { waitUntil: 'load' });
            await page.waitForTimeout(50); // allow paint & canvas execution
            // Run in-page diagnostic script
            const diagnostics = await page.evaluate((isMobile) => {
                const clippedText = [];
                const outOfBounds = [];
                const siblingOverlaps = [];
                const lowContrastText = [];
                const tinyTouchTargets = [];
                const elementsMap = [];
                const elements = Array.from(document.querySelectorAll('.roblox-gui-object'));
                for (const el of elements) {
                    const rect = el.getBoundingClientRect();
                    const path = el.getAttribute('data-path') || el.id;
                    const className = el.getAttribute('data-class') || el.className;
                    const text = el.querySelector('span')?.textContent || undefined;
                    elementsMap.push({
                        path,
                        className,
                        text,
                        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                    });
                    // 1. Text clipping check
                    if (text) {
                        const span = el.querySelector('span');
                        if (span && (span.scrollWidth > el.clientWidth + 1 || span.scrollHeight > el.clientHeight + 1)) {
                            clippedText.push({
                                path,
                                text,
                                scrollWidth: span.scrollWidth,
                                clientWidth: el.clientWidth
                            });
                        }
                    }
                    // 2. Out of bounds check
                    if (rect.right > window.innerWidth + 2 || rect.bottom > window.innerHeight + 2 || rect.left < -2 || rect.top < -2) {
                        outOfBounds.push({
                            path,
                            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                        });
                    }
                    // 3. Tiny touch targets on mobile
                    if (isMobile && (className === "TextButton" || className === "ImageButton" || className === "TextBox")) {
                        if (rect.width < 32 || rect.height < 32) {
                            tinyTouchTargets.push({
                                path,
                                width: rect.width,
                                height: rect.height
                            });
                        }
                    }
                }
                return {
                    clippedText,
                    outOfBounds,
                    siblingOverlaps,
                    lowContrastText,
                    tinyTouchTargets,
                    elementsMap,
                    totalElementsCount: elements.length
                };
            }, presetName.includes("mobile"));
            const buffer = await page.screenshot({ type: 'png' });
            const base64Png = buffer.toString('base64');
            if (outputPath) {
                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                fs.writeFileSync(outputPath, buffer);
            }
            return {
                base64Png,
                outputPath,
                diagnostics
            };
        }
        finally {
            await page.close();
        }
    }
    /**
     * Dispatches synthetic input and computes visual diff
     */
    static async interactAndDiff(initialHtml, action, updatedHtml, presetName = "desktop_1080p", outBeforePath, outAfterPath) {
        const browser = await this.getBrowser();
        const preset = DEVICE_PRESETS[presetName] || DEVICE_PRESETS.desktop_1080p;
        const page = await browser.newPage({
            viewport: { width: preset.width, height: preset.height }
        });
        try {
            // 1. Initial State
            await page.setContent(initialHtml, { waitUntil: 'load' });
            await page.waitForTimeout(50);
            const beforeBuffer = await page.screenshot({ type: 'png' });
            if (outBeforePath) {
                fs.mkdirSync(path.dirname(outBeforePath), { recursive: true });
                fs.writeFileSync(outBeforePath, beforeBuffer);
            }
            // 2. Dispatch Action
            if (action.type === 'click') {
                if (action.targetPath) {
                    const locator = page.locator(`[data-path="${action.targetPath}"], [data-path$="${action.targetPath}"]`).first();
                    await locator.click();
                }
                else if (action.x !== undefined && action.y !== undefined) {
                    await page.mouse.click(action.x, action.y);
                }
            }
            else if (action.type === 'drag' && action.x !== undefined && action.y !== undefined && action.toX !== undefined && action.toY !== undefined) {
                await page.mouse.move(action.x, action.y);
                await page.mouse.down();
                await page.mouse.move(action.toX, action.toY, { steps: 5 });
                await page.mouse.up();
            }
            else if (action.type === 'type' && action.text) {
                if (action.targetPath) {
                    const locator = page.locator(`[data-path="${action.targetPath}"], [data-path$="${action.targetPath}"]`).first();
                    await locator.fill(action.text);
                }
                else {
                    await page.keyboard.type(action.text);
                }
            }
            // 3. Render updated state
            await page.setContent(updatedHtml, { waitUntil: 'load' });
            await page.waitForTimeout(50);
            const afterBuffer = await page.screenshot({ type: 'png' });
            if (outAfterPath) {
                fs.mkdirSync(path.dirname(outAfterPath), { recursive: true });
                fs.writeFileSync(outAfterPath, afterBuffer);
            }
            // 4. Pixel Difference calculation
            let diffBytes = 0;
            const minLen = Math.min(beforeBuffer.length, afterBuffer.length);
            for (let i = 0; i < minLen; i++) {
                if (beforeBuffer[i] !== afterBuffer[i])
                    diffBytes++;
            }
            diffBytes += Math.abs(beforeBuffer.length - afterBuffer.length);
            const diffPercent = Number(((diffBytes / Math.max(beforeBuffer.length, 1)) * 100).toFixed(2));
            return {
                beforePng: beforeBuffer.toString('base64'),
                afterPng: afterBuffer.toString('base64'),
                pixelDifference: diffPercent,
                diffReport: `Action [${action.type}] executed successfully. Visual state divergence: ${diffPercent}%.`
            };
        }
        finally {
            await page.close();
        }
    }
}
