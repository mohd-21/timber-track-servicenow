/**
 * UI Action: Select lowest quotation
 * Table: Catalog Task [sc_task]    Form button    Client: false
 * Condition: current.u_type == 'procurement' && current.u_stage == 'quotes_in'
 */
(function () {
    var chosen = new TimberTrackProcurement().selectLowest(current.getUniqueValue());
    if (chosen) {
        gs.addInfoMessage('Lowest quotation selected.');
    } else {
        gs.addErrorMessage('No submitted quotation to select yet.');
    }
    action.setRedirectURL(current);
})();
