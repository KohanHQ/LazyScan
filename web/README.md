# Structure

```json
apps/
  web/
    src/
      main.ts              # app bootstrap
      app.ts               # router + layout wiring

      pages/
        home.ts            # currently reading / queue
        manga.ts           # manga detail + chapter list
        reader.ts          # image reader
        login.ts

      components/
        header.ts
        progress.ts
        button.ts
        modal.ts

      api/
        client.ts          # fetch wrapper
        auth.ts
        manga.ts
        chapter.ts

      state/
        session.ts         # auth user
        reader.ts          # current chapter / page
        queue.ts           # reading queue

      router/
        index.ts           # route definitions
        guards.ts          # auth guard

      styles/
        index.css          # aggregator; import order is load-bearing
        tailwind.css       # layer order, theme, utilities
        tokens.css         # :root defaults + design tokens
        reset.css          # bare-element resets (@layer base)
        components.css     # handrolled remainder, unlayered
        effects.css        # keyframes + motion overrides, imported last
        reader.css

      utils/
        dom.ts
        time.ts
        debounce.ts

    index.html
    vite.config.ts
    tsconfig.json
```
