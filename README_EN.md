<p align="center">
  <h1 align="center">NL2UML Agent</h1>
  <p align="center">
    <strong>Natural Language → UML Design Models ｜ Multi-Stage LLM Pipeline Engine</strong>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js" alt="Node.js" />
    <img src="https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Express-4.18-000000?logo=express" alt="Express" />
    <img src="https://img.shields.io/badge/Vercel_AI_SDK-6.0-000000?logo=vercel" alt="Vercel AI SDK" />
  </p>

  <p align="center">
    <a href="README.md">中文</a> | <a href="README_EN.md">English</a>
  </p>
</p>

---

## Project Overview

NL2UML Agent is an **Express server process** that runs as the backend engine for the NL2UML VS Code extension. It receives natural language requirement documents from the frontend and converts them into structured UML design models (JSON format) through a **multi-stage LLM pipeline**, outputting results under the project's `design_model/` directory.

### Core Capabilities

- Automatically extract a **Module Tree** from requirement documents
- Generate **Business Model Class Diagrams** for each leaf module
- Generate **Business Model Sequence Diagrams** for each leaf module
- Derive **Platform-Independent Models** (PIM: class + sequence diagrams) from business models
- Derive **Platform-Specific Models** (PSM: class + sequence diagrams, targeting Java/Spring Boot) from PIM
- Simultaneously produce equivalent **PlantUML (.puml)** files for visualization
- Support **short / medium / long** text processing strategies
- Support **iterative modification** of existing UML models

---

## System Architecture

```
Frontend (VS Code Webview)
        │
        ▼  HTTP POST (Bearer Token)
┌───────────────────────────────────┐
│         Express Service Layer      │
│  CORS + Auth Middleware            │
│                                    │
│  POST /uml                  ← Quick gen (short/med/long)  │
│  POST /generate-module-tree  ← Stage 1: Module Tree        │
│  POST /generate-all-class-diagrams    ← Stage 2: Class Diag. │
│  POST /generate-all-sequence-diagrams ← Stage 3: Seq. Diag.  │
│  POST /generate-all-pim-diagrams      ← Stage 4: PIM        │
│  POST /generate-all-psm-diagrams      ← Stage 5: PSM        │
│  POST /continue-design-pipeline ← Resume from checkpoint    │
│  GET  /health                ← Health check                 │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│       Pipeline Processing Layer   │
│                                    │
│  textUtils/                        │
│  ├── classfication.ts    Text classification    │
│  ├── process.ts          Short/med/modify       │
│  ├── longTextProcess.ts  Long text chunk+merge  │
│  ├── generateModuleTree.ts   Module tree gen    │
│  ├── generateClassDiagram.ts Class diagram gen  │
│  ├── generateSequenceDiagram.ts Seq. diagram gen│
│  ├── generatePim.ts       PIM generation        │
│  ├── generatePsm.ts       PSM generation        │
│  ├── fallbackPim.ts       PIM fallback          │
│  └── fallbackPsm.ts       PSM fallback          │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│      LLM Invocation Layer         │
│      (Vercel AI SDK)              │
│  utils/utils.ts                    │
│  ├── callUMLGenerator              │
│  ├── callModuleTreeLLM             │
│  ├── callClassDiagramLLM           │
│  ├── callSequenceDiagramLLM        │
│  ├── callMultiSequenceDiagramLLM   │
│  ├── callPimClassLLM / callPimSequenceLLM │
│  ├── callPsmClassLLM / callPsmSequenceLLM │
│  └── repair*Json (Schema repair retry)    │
└───────────┬───────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│       Quality Assurance Layer     │
│                                    │
│  repairUtils/repair.ts            │
│  ├── RepairJson<T>()  JSON repair + parse  │
│  ├── validateAndNormalizeResult_2()        │
│  └── transformToUMLModel()                 │
│                                    │
│  schemaUtils/businessModelSchemas.ts       │
│  ├── 6 JSON Schema definitions             │
│  └── validate*Schema() + $ref resolution   │
│                                    │
│  pumlUtils/                        │
│  ├── convertToPuml.ts   JSON→PUML  │
│  └── validatePuml.ts    PUML validation    │
└───────────────────────────────────┘
```

### Data Flow

```
Requirement Document (.md)
    │
    ▼
[Text Classification] → SHORT / MEDIUM / LONG
    │
    ▼
[Module Tree Generation] → design_model/module_tree.json
    │
    ├── [Business Class Diagrams] → modules/{module}/design/business_model_class.json + .puml
    │
    ├── [Business Sequence Diagrams] → modules/{module}/design/business_model_sequence.json + .puml
    │
    ├── [PIM Class Diagrams] → modules/{module}/design/pim_class.json + .puml
    │
    ├── [PIM Sequence Diagrams] → modules/{module}/design/pim_sequence.json + .puml
    │
    ├── [PSM Class Diagrams] → modules/{module}/design/psm_class.json + .puml
    │
    └── [PSM Sequence Diagrams] → modules/{module}/design/psm_sequence.json + .puml
```

---

## Directory Structure

```
agent/
├── src/
│   ├── app.ts                          # Express server entry, route definitions + middleware
│   ├── types/
│   │   ├── api.ts                      # API request/response type definitions
│   │   └── diagram.ts                  # UML model types (class, sequence, module tree, PIM/PSM)
│   └── utils/
│       ├── utils.ts                    # LLM invocation layer (Vercel AI SDK wrapper)
│       ├── progress.ts                 # Progress event emitter (stdout JSON lines)
│       ├── promptUtils/
│       │   ├── prompt.ts               # Module tree / class / sequence system prompts
│       │   ├── pimPrompts.ts           # PIM transformation prompts
│       │   └── psmPrompts.ts           # PSM transformation prompts
│       ├── repairUtils/
│       │   └── repair.ts               # JSON repair, validation, normalization, transformation
│       ├── schemaUtils/
│       │   └── businessModelSchemas.ts # JSON Schema loading, caching, validation engine
│       ├── pumlUtils/
│       │   ├── convertToPuml.ts        # UML JSON → PlantUML text conversion
│       │   └── validatePuml.ts         # PlantUML syntax validation
│       └── textUtils/
│           ├── classfication.ts        # Text length classification (SHORT/MEDIUM/LONG)
│           ├── process.ts              # Short / medium / modify mode processing
│           ├── longTextProcess.ts      # Long text chunking + parallelism + merging
│           ├── generateModuleTree.ts   # Module tree generation + full pipeline orchestration
│           ├── generateClassDiagram.ts # Batch class diagram generation for leaf modules
│           ├── generateSequenceDiagram.ts # Batch sequence diagram generation for leaf modules
│           ├── generatePim.ts          # Batch PIM class/sequence diagram generation
│           ├── generatePsm.ts          # Batch PSM class/sequence diagram generation
│           ├── fallbackPim.ts          # PIM sequence diagram fallback constructor
│           └── fallbackPsm.ts          # PSM class diagram fallback constructor
├── schemas/                            # 6 JSON Schema definition files
│   ├── business_model_class.schema.json
│   ├── business_model_sequence.schema.json
│   ├── pim_class.schema.json
│   ├── pim_sequence.schema.json
│   ├── psm_class.schema.json
│   └── psm_sequence.schema.json
├── package.json
├── tsconfig.json
├── README.md
└── README_EN.md
```

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.3 (ESM) |
| Web Framework | Express 4.18 |
| LLM SDK | Vercel AI SDK 6.0 (`ai` + `@ai-sdk/openai-compatible`) |
| JSON Repair | `jsonrepair` 3.13 |
| Environment | `dotenv` 17 |
| CORS | `cors` 2.8 |
| Schema Validation | Custom JSON Schema validation engine (supports `$ref`, `allOf`, `if/then`, `additionalProperties`) |
| Diagram Output | PlantUML (.puml) |

---

## API Endpoints

All endpoints (except `/health`) require `Authorization: Bearer <TOKEN>` authentication.

### `GET /health`
Health check, returns `{ status: "ok" }`.

### `POST /uml`
Quick UML class diagram generation. Automatically selects processing strategy based on text length.

**Request body:**
```typescript
{
  requirement: string;          // Natural language requirement (required, ≤10000 chars)
  language?: string;            // Target programming language
  history?: ClarificationTurn[]; // Multi-turn clarification history
  currentModel?: UMLModel;      // Current model (triggers modify mode when present)
}
```

### `POST /generate-module-tree`
Generate a module tree from a requirement document and automatically execute the full 6-stage design pipeline.

**Request body:**
```typescript
{
  projectRoot: string;              // Absolute path to project root
  requirementRelativePath: string;  // Relative path to requirement document
  projectName: string;              // Project name
  documentVersion?: string;         // Document version (default "1.0.0")
}
```

### `POST /generate-all-class-diagrams`
Generate business model class diagrams for all leaf modules.

### `POST /generate-all-sequence-diagrams`
Generate business model sequence diagrams for all leaf modules.

### `POST /generate-all-pim-diagrams`
Generate PIM class and sequence diagrams for all leaf modules.

### `POST /generate-all-psm-diagrams`
Generate PSM class and sequence diagrams for all leaf modules.

### `POST /continue-design-pipeline`
Resume from checkpoint: scan all leaf modules and continue the pipeline from the first missing step:
`business_model_class → business_model_sequence → pim_class → pim_sequence → psm_class → psm_sequence`

---

## Installation & Usage

### Environment Variables

The agent reads configuration from environment variables at startup (injected by the VS Code extension process):

| Variable | Description |
|----------|-------------|
| `AGENT_PORT` | Server listening port |
| `AGENT_TOKEN` | Bearer token for authentication |
| `NL2UML_LLM_BASE_URL` | LLM API base URL |
| `NL2UML_LLM_MODEL` | LLM model name |
| `NL2UML_LLM_API_KEY` | LLM API key |
| `NL2UML_LLM_PROVIDER` | LLM provider name (optional) |
| `NL2UML_LLM_TEMPERATURE` | LLM temperature (optional, default 0.1) |

### Local Development

```bash
cd agent
npm install
npm run dev      # ts-node development mode
```

### Production Build

```bash
npm run build    # TypeScript compilation → dist/
npm start        # Run compiled output
```

---

## Design Highlights

### 1. Six-Stage Layered Pipeline

Follows the classic **Business Model → PIM → PSM** MDA (Model-Driven Architecture) layered design:

- **Business Model Layer**: Domain-expert-oriented, expressing business semantics (Entity, AggregateRoot, DomainService)
- **PIM Layer**: Platform-independent logical architecture (layered / hexagonal / event-driven), introducing interfaces and abstractions
- **PSM Layer**: Platform-specific technical implementation (Spring Boot annotations, Java package structure, JPA mappings)

Each layer has independent JSON Schema validation and LLM repair retry mechanisms, ensuring output quality.

### 2. LLM Output Robustness

- **Three-tier fault tolerance**: `jsonrepair` fix → regex fallback parsing → Schema-validation-driven LLM retry (up to 5 attempts)
- **Fallback mechanism**: `fallbackPim.ts` / `fallbackPsm.ts` construct minimal valid output from upstream models when LLM fails completely
- **Normalization post-processing**: PascalCase correction, duplicate name prevention, grid layout auto-placement, relationship type mapping, multiplicity defaults

### 3. Tiered Processing Strategy

Automatically selects strategy based on input text length (character thresholds: 100 / 3000):

| Tier | Threshold | Strategy |
|------|-----------|----------|
| SHORT | ≤100 | Single-stage generation + multi-turn clarification loop |
| MEDIUM | 100–3000 | Single-stage direct generation |
| LONG | >3000 | Sentence-level chunking (1500 chars/chunk, 200-char overlap) → parallel generation → dedup merge |

Also supports **modify mode**: when `currentModel` is provided, the LLM performs incremental modification on the existing model rather than full regeneration.

### 4. Batch Parallelism & Progress Feedback

- Module-level parallelism: up to 3 modules processed concurrently per batch
- Use-case-level parallelism: sequence diagrams per module are batched (10 use cases per batch) and generated in a single LLM call
- Real-time progress events emitted via stdout JSON Lines, parsed and displayed by the VS Code extension as progress notifications

### 5. JSON Schema Validation Engine

Custom lightweight schema validator supporting:
- `$ref` reference resolution
- `type` matching (including `integer`)
- `enum` validation
- `required` field checking
- `additionalProperties: false` — rejects undeclared fields
- `allOf` / `if-then` conditional validation
- Recursive validation for nested objects and arrays

### 6. PlantUML Co-Output

Each stage produces `.puml` files alongside the JSON output, enabling direct visual preview in the IDE. Covers both class diagrams and sequence diagrams.

### 7. Long-Running Request Support

The Express server is configured with a **30-minute timeout** (`server.timeout = 1800000`), ensuring the complete 6-stage pipeline (from module tree through PSM sequence diagrams) has sufficient time to complete within a single HTTP request.

---

## Future Work

- [ ] Support more PSM target platforms (Python/Django, C#/.NET, TypeScript/NestJS)
- [ ] Introduce vector database caching for similar module design results to reduce LLM costs
- [ ] Add design model versioning and incremental updates
- [ ] Support user-defined JSON Schema extensions
- [ ] Add unit tests and integration tests for each pipeline stage
