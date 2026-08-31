const fs = require("fs");
const path = require("path");

const file = path.resolve(process.cwd(), "app/reel/page.tsx");
const source = fs.readFileSync(file, "utf8");

const oldBlock = `      const firstCut = await renderConfiguredVideo({\n        withMusic: false,\n        withCaptions: false,\n      });\n      await selfOptimizeRenderedCut(firstCut, false, false);\n\n      // The first render is already a valid preview even if the optional reviewer fails.\n      setStep(6);`;

const newBlock = `      const firstCut = await renderConfiguredVideo({\n        withMusic: false,\n        withCaptions: false,\n      });\n\n      // The rendered MP4 is already a valid preview. Show it immediately.\n      // Self-review/re-rendering is an optional background optimization layer\n      // and must never block the user from seeing the successful first cut.\n      setStep(8);\n\n      void selfOptimizeRenderedCut(firstCut, false, false).catch((reviewError) => {\n        console.warn(\n          "[ATLAS PRO EDIT] Background self-review failed; keeping first render.",\n          reviewError\n        );\n      });`;

if (source.includes(newBlock)) {
  console.log("ATLAS PREVIEW FLOW: already patched.");
  process.exit(0);
}

if (!source.includes(oldBlock)) {
  console.error("ATLAS PREVIEW FLOW: expected renderEditPreview block was not found. No changes made.");
  process.exit(2);
}

fs.writeFileSync(file, source.replace(oldBlock, newBlock), "utf8");
console.log("ATLAS PREVIEW FLOW: patched successfully.");
console.log("- Preview now opens on step 8 immediately after the first render.");
console.log("- Self-review continues in the background and cannot block the preview.");
