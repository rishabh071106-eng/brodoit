# Content schema

All learning content is plain JSON, loaded by the static pages in the site root.
Add a new exam by dropping a file in `data/exams/<id>.json` and listing it in `data/catalog.json`.

## data/exams/<id>.json

```jsonc
{
  "id": "nda",                       // must equal the file name
  "name": "NDA & NA",
  "category": "defence",             // defence | civil | banking | it
  "conductedBy": "UPSC",
  "tagline": "One line on what this exam gets you",
  "overview": {
    "about": "2-3 sentences",
    "eligibility": ["...", "..."],
    "pattern": [ { "paper": "Mathematics", "questions": 120, "marks": 300, "duration": "2.5 hours", "note": "-1/3 negative marking" } ],
    "frequency": "Twice a year",
    "officialSite": "https://upsc.gov.in"
  },
  "subjects": [
    {
      "id": "maths",
      "name": "Mathematics",
      "chapters": [
        {
          "id": "trigonometry",        // unique inside the exam
          "title": "Trigonometry essentials",
          "minutes": 4,                // estimated read/listen time
          "cards": [
            { "type": "concept", "title": "...", "body": "Short paragraph. **bold** allowed.", "points": ["optional bullet", "..."] },
            { "type": "formula", "title": "...", "points": ["sin²θ + cos²θ = 1", "..."] },
            { "type": "example", "title": "...", "body": "Worked example, step by step." },
            { "type": "tip",     "title": "Exam tip", "body": "..." },
            { "type": "quiz", "q": "Question?", "options": ["A", "B", "C", "D"], "answer": 2, "explain": "Why C is right." }
          ]
        }
      ]
    }
  ],
  "pyq": [
    { "year": 2025, "items": [ { "label": "NDA & NA (I) 2025 — Maths, GAT", "url": "https://...", "source": "UPSC (official)" } ] }
  ],
  "resources": [ { "label": "...", "url": "https://...", "note": "why it is useful", "free": true } ]
}
```

Card rules: 6–10 cards per chapter, one idea per card, body under ~70 words so it fits a phone screen,
and every chapter ends with 2–3 `quiz` cards. `answer` is the 0-based index into `options`.
