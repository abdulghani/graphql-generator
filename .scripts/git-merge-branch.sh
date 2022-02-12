#!/bin/bash

LIST_BRANCHES=($(echo $BRANCHES | tr ',' ' '))

# FETCH ALL BRANCHES
git fetch --all
git pull origin $MERGE_WITH

function merge_branch() {
    echo "MERGING ($1) BRANCH WITH ($MERGE_WITH)"
    git checkout $1
    git pull origin $1
    git merge $MERGE_WITH --no-ff --allow-unrelated-histories -s ort -X theirs
    echo "BRANCH ($1) SUCCESSFULLY MERGED WITH ($MERGE_WITH)"
    git checkout $MERGE_WITH
}

for branch in ${LIST_BRANCHES[@]}; do
    merge_branch $branch
done
