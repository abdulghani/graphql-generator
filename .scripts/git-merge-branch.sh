#!/bin/bash

CURRENT_BRANCH="$(git branch --show-current)"
MY_ARRAY=("one" "two" "three")

function merge_branch() {
    echo "MERGING ($1) BRANCH WITH ($MERGE_WITH)"
    git checkout $1
    git merge -s theirs $MERGE_WITH
    echo "BRANCH ($1) SUCCESSFULLY MERGED WITH ($MERGE_WITH)"
    git checkout $MERGE_WITH
}

for branch in ${MY_ARRAY[@]}; do
    merge_branch $branch
done
