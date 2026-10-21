# Written Reflection

> Written by the candidate without AI assistance (briefing §8).

## Reflection

### 1. What did you delegate to AI, and how did you provide context (files, instructions, verification steps)?



### 2. Where did the AI's output diverge from the requirements or from your own intent? How did you notice, and what did you change?



## Design questions

### 1. Exactly-once notification

> Issuing a certificate must also write an audit-log entry and send a notification. The API endpoint and a background job can both be retried and can run concurrently. How do you guarantee no learner is notified twice?



### 2. Tenant-local dates

> Certificates must be sorted and exported by tenant-local calendar date. Timestamps are stored in UTC. A colleague proposes storing one fixed UTC offset per tenant (Sydney +10, Perth +8) and converting with that offset everywhere. Sydney observes daylight saving time; Perth does not. What goes wrong with this proposal, and how would you implement it instead?



### 3. 100,000-row CSV export

> A single tenant grows to 100,000 certificates and the CSV export times out. Walk me through your fix.


