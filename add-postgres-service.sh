#!/bin/bash

sudo env PATH="$PATH" \
    serviceman add --system --username "$(whoami)" --name postgres -- \
    postgres -D "$HOME/.local/share/postgres/var" -p 5432
