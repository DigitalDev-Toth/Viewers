import { Meteor } from 'meteor/meteor';
import { Router } from 'meteor/clinical:router';
import { OHIF } from 'meteor/ohif:core';
import { TAPi18n } from 'meteor/tap:i18n';
import { dcm4chee,Study } from './service/nodes.js';


if (Meteor.isClient) {
    // Disconnect from the Meteor Server since we don't need it
    OHIF.log.info('Disconnecting from the Meteor server');
    Meteor.disconnect();

    Router.configure({
        loadingTemplate: 'loading'
    });

    Router.onBeforeAction('loading');
    TAPi18n.setLanguage('es');

    Router.route('/:id?', {
        onRun: function() {
            console.warn('onRun');
            // Retrieve the query from the URL the user has entered
            const query = this.params.query;
            const id = this.params.id;

            // console.debug("ID [%s]",id);
            // console.debug("QUERY [%s]",query.url);

            if (!id && !query.url) {
                console.log('No URL was specified. Use ?url=${yourURL}');
                return;
            }

            const next = this.next;
            const idUrl = `/api/${id}`;
            const url = query.url || idUrl;
            

            var that = this;
            /*
                carga "1.2.3.175778"
                no cargar "1.2.392.200036.9116.2.6.1.48.1221404871.1537410089.373942"
                no cargar completo 1.2.840.113663.1500.1.341670604.1.1.20180907.130921.15
                no carga 1.3.51.0.7.1567419892.12959.37187.41330.16773.29389.15670
            */
            // console.debug(id);
            Study.getAetitle(id)
                .then(Study.make)
                .then(function(structureJson){
                        OHIF.log.info(JSON.stringify(structureJson) );
                        that.data = structureJson;
                        
                        if (that.data.servers && query.studyInstanceUids) {
                            console.warn('Using Server Definition!');       

                            const server = that.data.servers.dicomWeb[0];
                            server.type = 'dicomWeb';       

                            const serverId = OHIF.servers.collections.servers.insert(server);       

                            OHIF.servers.collections.currentServer.insert({
                                serverId
                            });     

                            studyInstanceUids = query.studyInstanceUids.split(';');
                            const seriesInstanceUids = [];      

                            const viewerData = {
                                studyInstanceUids,
                                seriesInstanceUids
                            };      

                            OHIF.studies.retrieveStudiesMetadata(studyInstanceUids, seriesInstanceUids).then(studies => {
                                that.data = {
                                    studies,
                                    viewerData
                                };      

                                next();
                            });     

                            return;
                        }       

                        next();


                })
                .catch(function(error){
                        console.error("estudio no existe");
                        OHIF.log.warn('An error occurred while retrieving the JSON data');
                        // location.href = "http://google.cl";
                        document.write("<center>Not found</center>");
                        //next();
                })
                .catch(function(error){
                    console.error("ERROR2");
                    //console.error(that.data);
                });

            OHIF.log.info(`Sending Request to: ${url}`);
        },
        action() {
            // Render the Viewer with this data
            this.render('standaloneViewer', {
                data: () => this.data
            });
        }
    });
}

// This is ONLY for demo purposes.
if (Meteor.isServer) {
    // You can test this with:
    // curl -v -H "Content-Type: application/json" -X GET 'http://localhost:3000/getData/testId'
    //
    // Or by going to:
    // http://localhost:3000/api/testId

    Router.route('/api/:id', { where: 'server' }).get(function() {
        // "this" is the RouteController instance.
        // "this.response" is the Connect response object
        // "this.request" is the Connect request object
        const id = this.params.id;

        // Find the relevant study data from the Collection given the ID
        const data = RequestStudies.findOne({ transactionId: id });

        // Set the response headers to return JSON to any server
        this.response.setHeader('Content-Type', 'application/json');
        this.response.setHeader('Access-Control-Allow-Origin', '*');
        this.response.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        // Change the response text depending on the available study data
        if (!data) {
            this.response.write('No Data Found');
        } else {
            // Stringify the JavaScript object to JSON for the response
            console.error(data);
            this.response.write(JSON.stringify(data));
        }

        // Finalize the response
        this.response.end();
    });
}
