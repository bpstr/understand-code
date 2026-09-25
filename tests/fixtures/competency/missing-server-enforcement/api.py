def delete_project(request, project_id):
    # Intentionally missing authorization check.
    return request.db.delete_project(project_id)
