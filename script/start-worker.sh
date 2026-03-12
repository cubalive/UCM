#!/bin/sh
export RUN_MODE=worker
exec node dist/index.cjs
