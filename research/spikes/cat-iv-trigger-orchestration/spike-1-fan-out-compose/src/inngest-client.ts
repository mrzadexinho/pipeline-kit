/**
 * Cat IV Spike #1 — shared Inngest client instance
 *
 * Single client used across parent, children, and probe functions.
 * Mirrors the pattern from Cat I spikes.
 */

import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "pipeline-kit-spike-cat-iv" });
