#!/bin/bash

LIST_BRANCHES=($(echo $BRANCHES | tr ',' ' '))

function merge_branch() {
    echo "MERGING ($1) BRANCH WITH ($MERGE_WITH)"
    git checkout $1
    git merge -s theirs $MERGE_WITH
    echo "BRANCH ($1) SUCCESSFULLY MERGED WITH ($MERGE_WITH)"
    git checkout $MERGE_WITH
}

for branch in ${LIST_BRANCHES[@]}; do
    merge_branch $branch
done
