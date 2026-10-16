/**
 * Script Include: TimberTrackApprovals
 * Creates the approval requests used in the procurement, finance and return gates.
 * (Custom table because ServiceNow's own approver field points to a user; these gates approve by group.)
 */
var TimberTrackApprovals = Class.create();
TimberTrackApprovals.prototype = {
    initialize: function () {
        this.tasks = new TimberTrackTasks();
    },

    /**
     * @param {string} purpose   a TimberTrackConfig.APPROVAL purpose
     * @param {string} groupName approving group
     * @param {string} refId     record the decision applies to (RITM or procurement task)
     * @returns {string} sys_id of the approval
     */
    request: function (purpose, groupName, refId) {
        var approval = new GlideRecord('u_approval_request');
        approval.initialize();
        approval.setValue('u_purpose', purpose);
        approval.setValue('u_ref', refId);
        approval.setValue('u_group', this.tasks.groupId(groupName));
        approval.setValue('state', TimberTrackConfig.APPROVAL.REQUESTED);
        return approval.insert();
    },

    type: 'TimberTrackApprovals'
};
