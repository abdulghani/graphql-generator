#!/bin/bash

LIST_BRANCHES=($(echo $BRANCHES | tr ',' ' '))

# FETCH ALL BRANCHES
git fetch --all

function merge_branch() {
    echo "MERGING ($1) BRANCH WITH ($MERGE_WITH)"
    git merge -s ours $1
    echo "BRANCH ($1) SUCCESSFULLY MERGED WITH ($MERGE_WITH)"
}

for branch in ${LIST_BRANCHES[@]}; do
    merge_branch $branch
done
