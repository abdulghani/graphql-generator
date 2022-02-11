#!/bin/bash

if [[ ! $CI ]]; then
    if [[ "$(which git)" ]]; then
        echo "SETTING GIT PULL CONFIG"
        git config pull.rebase true
    else
        echo "GIT IS NOT SETUP. PLEASE SETUP GIT"
    fi
else
    echo "NOT RUNNING IN CI"
fi
