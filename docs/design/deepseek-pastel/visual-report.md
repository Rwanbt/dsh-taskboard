# DeepSeek Pastel — visual validation (feat/ui-deepseek-pastel - colour system (dev 94fddfa))

- Generated: 2026-11-14T17:37:31.404Z
- Real DSH host: http://127.0.0.1:64941 (isolated DSH home, plugin linked from the working tree)
- Browser: C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe
- Mockup: C:\Users\barat\Downloads\TaskBoard_DeepSeek_Pastel_GOAL_et_References\design-reference\DSH_Task_Board_DeepSeek_Pastel_Maquette_V1.html

## Checks

| Check | Result | Detail |
| --- | --- | --- |
| real plugin mounted with a dense board | PASS | 340 cards, 5 columns |
| five readable columns | PASS | [236,236,236,236,236] |
| no host-level horizontal overflow | PASS | overflow=0px |
| prefers-reduced-motion disables card transitions | PASS | {"transitionDuration":"0s","transform":"none"} |
| detail pane exposes the tone picker (8 tones + auto) | PASS | swatches=9 |
| category mode: one surface per category (unclassified included) | PASS | 10 categories sampled |
| priority mode: every card stays in its urgency family | PASS | 14/14 cards |
| priority mode: the category nuance varies the urgent family | PASS | 2 urgent surfaces |
| priority mode without nuance: exactly one surface per urgency | PASS | urgent=1 normal=1 relaxed=1 |
| project mode: one surface per project | PASS | 2 projects |
| card mode: colours are stable across re-renders | PASS | 9 cards compared |
| light theme applied by the host (not forced by the plugin) | PASS | {"dark":false,"scheme":"light","bodyBg":"rgb(255, 255, 255)","bodyBgLuminance":null} |
| light theme: priority families preserved | PASS | 14/14 cards |
| mobile column navigation is visible | PASS | {"boardExists":true,"mobilebarDisplay":"flex","buttons":5,"pageOverflowX":0,"boardOverflowX":0,"columnWidth":337,"panelRows":1} |
| mobile has no host-level horizontal overflow | PASS | overflow=0px |
| no legacy priority stripe on the card (::before content none) | PASS | ::before content=none |
| mockup geometry/typography deltas within tolerance | PASS | all within tolerance |
| dark contrast titleOnCard ≥ 4.5 | PASS | ratio=11.26 |
| dark contrast descriptionOnCard ≥ 4.5 | PASS | ratio=8.16 |
| dark contrast projectOnCard ≥ 4.5 | PASS | ratio=6.39 |
| dark contrast badgeOnCard ≥ 4.5 | PASS | ratio=6.53 |
| dark contrast priorityOnCard ≥ 4.5 | PASS | ratio=8.16 |
| light contrast titleOnCard ≥ 4.5 | PASS | ratio=9.33 |
| light contrast descriptionOnCard ≥ 4.5 | PASS | ratio=5.17 |
| light contrast projectOnCard ≥ 4.5 | PASS | ratio=5.25 |
| light contrast badgeOnCard ≥ 4.5 | PASS | ratio=6.8 |
| light contrast priorityOnCard ≥ 4.5 | PASS | ratio=5.17 |
| category mode: worst card title contrast ≥ 4.5 | PASS | min ratio=9.85 |
| priority mode: worst card title contrast ≥ 4.5 | PASS | min ratio=10.14 |
| project mode: worst card title contrast ≥ 4.5 | PASS | min ratio=10.68 |
| card mode: worst card title contrast ≥ 4.5 | PASS | min ratio=10.35 |
| card mode renders several distinct palette tones | PASS | 8 tones |

## Screenshots

- `desktop-dark-1440x900.png`
- `detail-1440x900.png`
- `mode-category-dark-1440x900.png`
- `mode-priority-dark-1440x900.png`
- `mode-project-dark-1440x900.png`
- `mode-card-dark-1440x900.png`
- `mode-priority-no-nuance-dark-1440x900.png`
- `settings-appearance-category.png`
- `settings-appearance-priority.png`
- `desktop-light-1440x900.png`
- `mode-priority-light-1440x900.png`
- `dense-backlog-1440x900.png`
- `mobile-390x844.png`

## Mockup deltas

| Property | DSH | Mockup | Δ | In tolerance |
| --- | --- | --- | --- | --- |
| card.title.font-size | 13.5px | 13px | 0.5 | yes |
| card.title.font-weight | 710 | 710 | 0 | yes |
| card.project.font-size | 10px | 10px | 0 | yes |
| card.desc.font-size | 11.25px | 11.25px | 0 | yes |
| card.priority.font-size | 10.5px | 10.5px | 0 | yes |
| column.border-radius | 16px | 15px | 1 | yes |
| column.gap | 12px | 12px | 0 | yes |
| board.title.font-size | 19px | 20px | -1 | yes |
| density.compact.radius | 11px | 11px | 0 | yes |
| density.compact.padding | 11px | 11px | 0 | yes |
| density.compact.gap | 12px | 12px | 0 | yes |
| density.compact.titleFont | 13px | 13px | 0 | yes |
| density.comfortable.radius | 15px | 15px | 0 | yes |
| density.comfortable.padding | 16px | 16px | 0 | yes |
| density.comfortable.gap | 12px | 12px | 0 | yes |
| density.comfortable.titleFont | 13px | 13px | 0 | yes |
| density.spacious.radius | 18px | 18px | 0 | yes |
| density.spacious.padding | 20px | 20px | 0 | yes |
| density.spacious.gap | 12px | 12px | 0 | yes |
| density.spacious.titleFont | 13.5px | 13.5px | 0 | yes |
| card.tone.violet.background | rgb(52, 49, 76) | rgb(52, 48, 77) | 1 | yes |

## Limitations

- none recorded
