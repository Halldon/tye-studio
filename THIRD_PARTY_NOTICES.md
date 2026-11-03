# Third party notices

Tye Studio uses separately licensed dependencies. Preserve their license files and notices in distributed builds. The lockfile identifies exact installed versions.

- React and React DOM: MIT.
- React Flow and xyflow: MIT. Pro examples are not included.
- Comfy TypeScript SDK: MIT.
- fflate: MIT.
- @fix-webm-duration/fix and @fix-webm-duration/parser: MIT.
- Lucide icons: ISC.
- Drizzle ORM: Apache-2.0.
- Vinext and its runtime dependencies: retain the licenses shipped in their packages.
- The Sites Vite integration and starter runtime retain the bundled notice under `scripts/vite/` and package licenses.

ComfyUI runs as a separate engine. Its core and frontend are GPL-3.0; those frontend sources are not copied here. Model weights, text encoders, VAEs, control models, LoRAs and custom nodes require separate license review before installation or redistribution. No weights are included.

Interface research screenshots are stored outside this application checkout and are not application assets. Product names identify interoperability or research references and do not imply affiliation.

The three starter illustrations in `public/graphics/` are original AI-generated artwork. A user-provided Sam Stoof post informed texture and palette only; its media, logo and UI are not distributed. Generation prompts and provenance are recorded in `docs/generated-artwork.json` and `docs/generated-artwork-v2.json`.
