# Government job record (one object in `jobs`)

```jsonc
{
  "id": "ssc-cgl-2026",                 // lowercase slug, unique
  "title": "SSC Combined Graduate Level (CGL) 2026",
  "org": "Staff Selection Commission",
  "category": "central",                // central | defence | police | banking | railways | teaching | psu | state | health | other
  "posts": 14582,                       // number of vacancies, or null if not announced
  "qualification": "Graduate",          // short: "10th pass", "12th pass", "Graduate", "B.Tech", "MBBS", ...
  "qualificationDetail": "Bachelor's degree from a recognised university; some posts need specific subjects",
  "ageMin": 18, "ageMax": 32,           // general category limits in years; null if not applicable
  "ageNote": "Relaxation: SC/ST 5 yrs, OBC 3 yrs, PwBD 10 yrs as per rules",
  "postedDate": "2026-07-14",           // date the notification was released (YYYY-MM-DD)
  "lastDate": "2026-08-10",             // last date to apply (YYYY-MM-DD) or null
  "examDate": "Tier 1: Sept 2026 (tentative)",   // free text or null
  "fee": "₹100 (General/OBC); no fee for women, SC/ST, PwBD, ex-servicemen",
  "salary": "Pay Level 4 to 8 (₹25,500 – ₹1,51,100)",
  "location": "All India",
  "about": "2–3 plain sentences: what the job is and who should apply.",
  "selection": ["Tier 1 CBT", "Tier 2 CBT", "Document verification"],
  "steps": ["Register on ssc.gov.in (One-Time Registration)", "Fill the CGL form", "Upload photo & signature", "Pay the fee", "Download the confirmation page"],
  "documents": ["Photo", "Signature", "10th certificate for DOB", "Graduation marks"],
  "officialUrl": "https://ssc.gov.in/...",   // official notification / recruitment page (official domain only)
  "applyUrl": "https://ssc.gov.in/...",      // official application portal (official domain only)
  "sourceName": "ssc.gov.in"
}
```
