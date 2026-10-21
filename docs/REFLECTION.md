# Written Reflection

> Written by the candidate without AI assistance (briefing §8).

## Reflection

### 1. What did you delegate to AI, and how did you provide context (files, instructions, verification steps)?

At first, I asked AI to read the three files and understand the requirements as a PM. Then I let it to search from websites for skills which are helpful in this project, like skills about frontend and backend development.

Then I input the prompt, contains the steps for this project, my personal preferences in development, permissions, working schedules and etc.

Now AI already known the requirements of the project and my habits as a developer.

Next, I asked it to re-analyze the understand of the requirements, plan the technical parts, including frameworks, project structure and so on.

After all, I noticed it to revise everything including all plans, development todo list, knowledge documents and more.

Finally, I asked it to develop the project step by step without interrupted unless there are any thing must discuss with me or there are any thing not that clearly.

During the development, I always asked it when I notice something may not clear or correct. But I tried not to interrupt it frequently.

### 2. Where did the AI's output diverge from the requirements or from your own intent? How did you notice, and what did you change?


During the development, I noticed there is a misunderstanding between AI and me. I thought there are two types of tenants, admin tenant and general tenant. So I asked AI to make sure the tests cover all kinds of tenants. But AI responded that there is only one type of tenant, admin tenant. Then I was going to read the requirements again and discuss this with AI. I found I was wrong. Then I asked it to continue its work with original understanding.


## Design questions

### 1. Exactly-once notification

> Issuing a certificate must also write an audit-log entry and send a notification. The API endpoint and a background job can both be retried and can run concurrently. How do you guarantee no learner is notified twice?

Using Unique Key to make sure on completion on one course for one learner only be assigned one certificate. Using database transaction to make sure the writing is atomic. Then make sure the whole workflow(create certificate, create notification event, etc.) in one transaction. one step failed , then the whole workflow failed. The previous succeeded steps are being rollback.

### 2. Tenant-local dates

> Certificates must be sorted and exported by tenant-local calendar date. Timestamps are stored in UTC. A colleague proposes storing one fixed UTC offset per tenant (Sydney +10, Perth +8) and converting with that offset everywhere. Sydney observes daylight saving time; Perth does not. What goes wrong with this proposal, and how would you implement it instead?

because Sydney timezone changed during winter and spring(+10/+11). But Perth doesn't have the problem.

1. store all Timestamps by using UTC time.
2. store timezone name (Australia/Sydney)
3. convert from UTC to specific timezone time by using framework/libraries

Those libraries always converting time between different timezones automatically.

### 3. 100,000-row CSV export

> A single tenant grows to 100,000 certificates and the CSV export times out. Walk me through your fix.

1. divide the workflow to several parts, read data from DB, convert to suitable format(if necessary), export to CSV
2. check the SQL performance, if it's slow, use explain to check which step is slow and optimize it by for example, add indexes, use JOIN to avoid N+1 queries, pagination by using offset(avoid loading all data once)
3. If not working, check if the export stream(file stream) times out. If so, then change the export pipeline to async job and divide data in different parts then write to the CSV file chunk by chunk.
Two ways to write, A/B test
1. Use buffered IO to write the data in file.
2. keep the file opened and use stream IO to write data in file.
