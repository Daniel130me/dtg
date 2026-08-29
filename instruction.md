# DTG Platform — Engineering Instructions

These instructions apply to **all code written** in this repository.

## Code quality requirements

All code written must be:

- Readable
- Well-structured
- Commented where logic is non-obvious
- Easy for another developer to pick up and extend
- Easy to understand
- Easy to maintain
- Easy to extend later
- Reduced in query count for performance optimization

## Avoid

- Over-engineering
- Magic values
- Hard-coded assumptions

## Commit conventions

- Always write commit messages using **Conventional Commits** standard style
  (e.g. `feat(courses): ...`, `fix(auth): ...`, `chore(db): ...`).
- Always commit as user **Daniel130me**, email **kosokodaniel@gmail.com**.

## Compliance check

After every implementation, always check whether the implementation follows the
specifications above, and **always include this check in the walkthrough**.
