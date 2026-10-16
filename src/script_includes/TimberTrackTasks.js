/**
 * Script Include: TimberTrackTasks
 * Creates sc_tasks and assigns them to the least busy member of a group.
 */
var TimberTrackTasks = Class.create();
TimberTrackTasks.prototype = {
    initialize: function () {},

    groupId: function (groupName) {
        var gr = new GlideRecord('sys_user_group');
        gr.addQuery('name', groupName);
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    },

    openTaskCount: function (userId) {
        var gr = new GlideRecord('sc_task');
        gr.addActiveQuery();
        gr.addQuery('assigned_to', userId);
        gr.query();
        return gr.getRowCount();
    },

    /** Member of the group with the fewest open tasks, or null if the group is empty. */
    leastBusyMember: function (groupName) {
        var groupId = this.groupId(groupName);
        if (!groupId) {
            return null;
        }
        var members = new GlideRecord('sys_user_grmember');
        members.addQuery('group', groupId);
        members.query();

        var best = null;
        var bestCount = 0;
        while (members.next()) {
            var userId = members.getValue('user');
            var count = this.openTaskCount(userId);
            if (best === null || count < bestCount) {
                best = userId;
                bestCount = count;
            }
        }
        return best;
    },

    /**
     * @param {Object} spec  { type, group, ritm?, summary?, fields? }
     * @returns {string} sys_id of the new task
     */
    create: function (spec) {
        var task = new GlideRecord('sc_task');
        task.initialize();
        task.setValue('u_type', spec.type);
        task.setValue('assignment_group', this.groupId(spec.group));
        var assignee = this.leastBusyMember(spec.group);
        if (assignee) {
            task.setValue('assigned_to', assignee);
        }
        task.setValue('state', TimberTrackConfig.STATE.OPEN);
        task.setValue('active', true);
        task.setValue('short_description', spec.summary || '');

        if (spec.ritm) {
            var ritm = new GlideRecord('sc_req_item');
            if (ritm.get(spec.ritm)) {
                task.setValue('request_item', spec.ritm);
                task.setValue('request', ritm.getValue('request'));
            }
        }
        var fields = spec.fields || {};
        for (var name in fields) {
            if (Object.prototype.hasOwnProperty.call(fields, name)) {
                task.setValue(name, fields[name]);
            }
        }
        return task.insert();
    },

    /** Close a task as complete (what the assignee does in the UI). */
    close: function (taskId) {
        var task = new GlideRecord('sc_task');
        if (task.get(taskId)) {
            task.setValue('state', TimberTrackConfig.STATE.CLOSED_COMPLETE);
            task.setValue('active', false);
            task.update();
        }
    },

    type: 'TimberTrackTasks'
};
