# Web UI — Happy Path States

See `mockup-happy.html` for full visual reference.

---

## Loop running (normal iteration)

- Header badge: `● running` in green
- Stop buttons: visible and enabled
- Metrics: updating in real time via SSE
- Alert bar: hidden (no alerts)
- Pipeline: layers progress left to right as review advances
- Worker output: lines stream in real time
- Second Mind: hidden until triggered
- Ask area: always visible

---

## Loop running (with alert)

- Alert bar appears above pipeline with amber color
- Content: short description of the alert (e.g. "L4 escalation triggered after 2 consecutive REVISEs")
- Alert bar disappears when condition clears

---

## Second Mind triggered

- Second Mind panel appears in right column
- New message bubble added with trigger label (e.g. "threshold trigger · iteration 2")
- Response count increments in panel header
- Panel was previously hidden if no responses existed

---

## Loop idle (waiting for worker)

- Pipeline shows last completed layer state
- Worker output shows last lines from previous iteration
- Metrics frozen until next iteration starts

---

## Loop finished — see STATES-ERROR.md

- SHIPPED → State 7 (green terminal)
- BLOCKED → State 6 (red terminal)
- Budget exhausted → State 8 (amber stop)
