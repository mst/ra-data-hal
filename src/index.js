import {
  CREATE,
  GET_LIST,
  GET_MANY,
  GET_MANY_REFERENCE,
  GET_ONE,
  UPDATE,
  DELETE,
  HttpError
} from 'react-admin'
import { assoc, last, path, split } from 'ramda'
import { Navigator } from 'halboy'
import inflection from 'inflection'
import qs from 'qs'
import { buildReactAdminParams } from './query'

const capitalizeFirstLetter = string =>
  string.charAt(0).toUpperCase() + string.slice(1)

const log = (request, result) => {
  const { type, resourceName, params } = request

  if (console.group) {
    console.groupCollapsed(type, resourceName, JSON.stringify(params))
    console.log(result)
    console.groupEnd()
  } else {
    console.log('RADataHAL query ', type, resourceName, params)
    console.log('RADataHAL result', result)
  }
}

//const getId = id => (id && id.includes(':') ? last(split(':', id)) : id)
const getId = id => id 

const navToResult = async (navigator, method = 'get', ...args) => {
  const resourceResult = await navigator[method](...args)

  const status = resourceResult.status()
  if (status >= 400) {
    const resource = resourceResult.resource()
    const errorContext = resource.getProperty('errorContext')
    const errorMessage =
      path(['problem'], errorContext) ||
      errorContext ||
      'Error has happened creating resource'
    throw new HttpError(errorMessage, status)
  }

  return resourceResult
}

const getSingleResult = async (navigator, resourceName, url) => {
  return navToResult(navigator, 'getUrl', url)
}

const navToResource = async (navigator, method = 'get', ...args) => {
  return (await navToResult(navigator, method, ...args)).resource()
}

const getSingleResource = async (navigator, resourceName, id) => {
  return (await getSingleResult(navigator, resourceName, id)).resource()
}

const handleRequest = async (apiUrl, type, resourceName, params) => {
  const discoveryResult = await Navigator.discover(apiUrl)

  switch (type) {
    case GET_LIST: {
      const fullParams = buildReactAdminParams(params)
      const resource = await navToResource(
        discoveryResult,
        'get',
        resourceName,
        fullParams,
        {
          paramsSerializer: params =>
            qs.stringify(params, { arrayFormat: 'repeat' })
        }
      )
      const total = resource.getProperty('page').totalElements;
      const data = resource.getResource(resourceName).map(r => Object.assign({}, {id: r.toObject()._links.self.href}, r.toObject()));
      console.log(resource.getResource(resourceName));
      console.log(data);
      return { data, total }
    }

    case GET_ONE: {
      return {
        data: (await getSingleResource(
          discoveryResult,
          resourceName,
          getId(params.id)
        )).toObject()
      }
    }

    case CREATE: {
      var postResult = (await discoveryResult.post("users", params.data))
      console.log(postResult)


      console.log(postResult.location())
      console.log(postResult.resource())

      const data = postResult.resource().toObject()

      return { data }
    }

    case GET_MANY: {
      const urls= params.ids.map(getId)

      // return with id => url, must be consistent with the requested url
      const data = await Promise.all(
        urls.map(async url =>
          Object.assign({}, {id:url},(await getSingleResource(
            discoveryResult,
            resourceName,
            url 
          )).toObject())
        )
      )
      console.log(data)
      return { data, total: data.length }
    }

    case GET_MANY_REFERENCE: {
      const resource = await navToResource(
        discoveryResult,
        'getUrl',
        params.id,
        {
          ...buildReactAdminParams(params),
          [params.target]: params.id
        },
        {
          paramsSerializer: params =>
            qs.stringify(params, { arrayFormat: 'repeat' })
        }
      )

      const data = resource
        .getResource(resourceName)
        .map(resource => Object.assign({}, {id: resource.toObject()._links.self.href},resource.toObject()))

      const total = resource.getProperty(
        `total${capitalizeFirstLetter(resourceName)}`
      )

      return { data, total }
    }

    case UPDATE: {
      const body = assoc('id', getId(path(['data', 'id'], params)), params.data)
      const resource = await navToResource(
        discoveryResult,
        'putUrl',
        params.data._links.self.href,
        body
      )
      const data = resource.toObject()

      return { data }
    }

    case DELETE: {
      const getResult = await getSingleResult(
        discoveryResult,
        inflection.singularize(resourceName),
        getId(params.id)
      )
      const data = getResult.resource().toObject()

      await getResult.delete('self')

      return { data: data }
    }

    default:
      throw new Error(`Unsupported fetch action type ${type}`)
  }
}

export default (apiUrl, { debug = false } = {}) => {
  return async (type, resourceName, params) => {
    let response

    try {
      response = await handleRequest(apiUrl, type, resourceName, params)
    } catch (error) {
      debug && log({ type, resourceName, params }, error)
      throw error
    }

    debug && log({ type, resourceName, params }, response)

    return response
  }
}
