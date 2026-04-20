---
title: "Why on-call alerting is mostly paid software"
date: "2026-03-22"
excerpt: "A frank look at the OSS gap. PagerDuty, Opsgenie, and Rootly didn't win by accident — and Alertmanager isn't what you think it is."
tags: ["oncall", "alerting"]
---

Let's get the uncomfortable part out of the way. The on-call alerting space — the part that actually pages a human at 03:47 — is dominated by paid software. PagerDuty, Opsgenie, Splunk On-Call, Rootly, incident.io.

People point at Alertmanager and say "but we have Prometheus, it's free." Alertmanager is a router. It's not an on-call tool. It doesn't do schedules. It doesn't do escalation with a real person acknowledging. It doesn't do overrides, doesn't do audit trails, doesn't do post-incident comms.

```yaml
# what alertmanager gives you
route:
  receiver: 'pager'
  group_by: ['alertname', 'cluster']
receivers:
  - name: 'pager'
    webhook_configs:
      - url: 'https://events.pagerduty.com/...'
#                      ^^^^^^^^^^^^^^^^^^^^
#                      you are still paying pagerduty.
```

The reason is boring and correct: the hard part of on-call alerting isn't the routing. It's the sociotechnical stuff — who's on, who's next, who's been up too long, what happened last Thursday at 4am. That stuff is a product, and products cost money.

## what I'd want from an OSS version

- Schedules as code. Real rotations, overrides as commits.
- Push notifications that actually wake you up.
- An incident timeline you can export to Markdown.
- Integrations with Slack/Teams that aren't an afterthought.
